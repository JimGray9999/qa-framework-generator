import { spawn as nodeSpawn } from "child_process";
import { AsyncLocalStorage } from "async_hooks";

// Process lifecycle for a test run.
//
// A run launches many subprocesses (venv, pip, browser downloads, builds, the test
// runner itself, plus the browsers those start). To bound a run we need to stop all of
// them, not just the one we happen to be waiting on. Everything spawned while a run's
// function executes is registered in that run's scope (via AsyncLocalStorage, so the
// existing `spawn(...)` call sites need no changes), and the scope can be killed as a
// whole and awaited.

const storage = new AsyncLocalStorage();
const IS_WIN = process.platform === "win32";
const KILL_WAIT_MS = 10_000; // how long to wait for a killed process to be reaped
const GROUP_EMPTY_WAIT_MS = 2_000; // after the leader exits, how long to wait for its group to empty
const ownGroup = new WeakSet(); // children we started as their own process-group leader

// Drop-in replacement for child_process.spawn.
export function spawn(command, args, options = {}) {
  const scope = storage.getStore();
  if (scope?.closed) {
    // A cancelled run must not start new work (e.g. the next setup step after a kill).
    throw new Error("Run was cancelled; not starting a new process");
  }
  // POSIX: make the child a process-group leader so one signal reaches its descendants
  // (browsers, test workers). Windows uses `taskkill /T` instead.
  const detached = options.detached ?? (!IS_WIN && !!scope);
  const child = nodeSpawn(command, args, { ...options, detached });
  if (detached && !IS_WIN) ownGroup.add(child);
  if (scope) {
    scope.children.add(child);
    const forget = () => scope.children.delete(child);
    child.once("close", forget);
    child.once("error", forget);
  }
  return child;
}

// POSIX: resolve once no process is left in the group (kill(-pgid, 0) fails with ESRCH),
// or after a bounded wait. The group id cannot be reused while any member is alive, so
// probing it is safe; at worst a recycled id makes us wait out the bound.
async function groupGone(pgid) {
  const end = Date.now() + GROUP_EMPTY_WAIT_MS;
  while (Date.now() < end) {
    try { process.kill(-pgid, 0); } catch { return; }
    await new Promise((r) => setTimeout(r, 20));
  }
}

// Kill a child and its descendants, resolving once the child has been reaped and (on
// POSIX) its process group is empty, or after a bounded wait, so a process stuck in the
// kernel can never hold a run slot forever.
export function killTree(child) {
  return new Promise((resolve) => {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      console.error(`[process] pid ${child.pid} was still alive ${KILL_WAIT_MS}ms after being killed`);
      resolve();
    }, KILL_WAIT_MS);
    child.once("exit", async () => {
      clearTimeout(timer);
      if (ownGroup.has(child)) await groupGone(child.pid);
      resolve();
    });
    try {
      if (IS_WIN) {
        nodeSpawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
          .on("error", () => { try { child.kill("SIGKILL"); } catch { /* already gone */ } });
      } else if (ownGroup.has(child)) {
        process.kill(-child.pid, "SIGKILL"); // negative pid = the whole process group
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }
  });
}

// Throws if the enclosing run has been cancelled (deadline hit or failed), so loops that
// start several processes can stop instead of launching more. A no-op outside a run.
export function assertNotCancelled() {
  if (storage.getStore()?.closed) throw new Error("Run was cancelled; not starting a new process");
}

// For children started outside a run scope (e.g. the local Claude CLI): after spawning one with
// `detached: true` on POSIX (its own process group), register it so killTree signals the group.
export function markOwnGroup(child) {
  if (!IS_WIN) ownGroup.add(child);
}

export class RunDeadlineError extends Error {
  constructor(ms) {
    super(`The run exceeded its ${Math.round(ms / 60000 * 10) / 10}-minute limit and was stopped.`);
    this.code = "RUN_DEADLINE";
    this.expose = true;
  }
}

// Run `fn` with a deadline that covers everything it does. Whether it finishes, fails or
// times out, every process it started is killed and reaped BEFORE this promise settles,
// so a caller that frees a resource afterwards (a run slot) never frees it early.
export async function runWithDeadline(fn, deadlineMs) {
  const scope = { children: new Set(), cleanups: new Set(), closed: false };
  let timer;
  const work = storage.run(scope, fn);
  work.catch(() => {}); // if the deadline wins, a later rejection must not be unhandled
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new RunDeadlineError(deadlineMs)), deadlineMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    scope.closed = true;
    await Promise.all([...scope.children].map(killTree));
    // Resources that outlive a killed process (a Docker container keeps running when its client is
    // killed) are torn down here and awaited, so the run slot is never freed while one is alive.
    await Promise.all([...scope.cleanups].map((fn) => Promise.resolve().then(fn).catch((e) => console.error("[process] cleanup failed:", e?.message))));
  }
}

// Register an async teardown with the enclosing run. Returns a function that unregisters it (call
// it once the resource is confirmed gone). Outside a run there is no scope, and this is a no-op.
export function registerCleanup(fn) {
  const scope = storage.getStore();
  if (!scope) return () => {};
  scope.cleanups.add(fn);
  return () => scope.cleanups.delete(fn);
}
