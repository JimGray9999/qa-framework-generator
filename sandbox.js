import { spawn as nodeSpawn } from "child_process";
import { randomBytes } from "crypto";
import { open, lstat, readdir } from "fs/promises";
import { constants } from "fs";
import { join } from "path";
import { spawn, registerCleanup } from "./processScope.js";
import { envInt, MAX_TIMER_MS } from "./config.js";

// Sandboxed test execution (audit C3). Generated tests are model output that was influenced by
// untrusted pages or repositories, so they must not run directly on the host. With QAFG_SANDBOX=docker
// each run executes inside a throwaway Docker container:
//   - an install phase with network (pip install, browser download), then a test phase;
//   - no capabilities, no privilege escalation, read-only root, a pids/memory/cpu cap;
//   - one bind mount (the run's temp directory) and an explicit environment, so none of the server's
//     environment (API keys) is visible to the generated code.
// The test phase keeps network by default because the tests must reach the site under test; set
// QAFG_SANDBOX_TEST_NETWORK=none for runs that need no network. See CLAUDE.md for the trade-off.

export const SANDBOX_IMAGE = "qafg-sandbox-python";

function sandboxError(message) {
  const err = new Error(message);
  err.code = "SANDBOX";
  err.expose = true;
  return err;
}

// "off" (default) or "docker". An unrecognised value is an error, not "off": a typo must not
// silently turn the protection off.
export function sandboxMode(env = process.env) {
  const raw = String(env.QAFG_SANDBOX ?? "").trim().toLowerCase();
  if (raw === "" || raw === "off") return "off";
  if (raw === "docker") return "docker";
  throw sandboxError(`QAFG_SANDBOX must be "docker" or "off" (got "${raw.slice(0, 20)}").`);
}

export function sandboxLimits(env = process.env) {
  const memory = String(env.QAFG_SANDBOX_MEMORY ?? "2g").trim().toLowerCase();
  if (!/^[1-9]\d{0,5}[mg]$/.test(memory)) throw sandboxError('QAFG_SANDBOX_MEMORY must look like "2g" or "1536m".');
  const cpus = String(env.QAFG_SANDBOX_CPUS ?? "2").trim();
  if (!/^(0\.\d{1,2}|[1-9]\d?(\.\d{1,2})?)$/.test(cpus)) throw sandboxError('QAFG_SANDBOX_CPUS must be a number such as "2" or "0.5".');
  const testNetwork = String(env.QAFG_SANDBOX_TEST_NETWORK ?? "bridge").trim().toLowerCase();
  if (testNetwork !== "bridge" && testNetwork !== "none") throw sandboxError('QAFG_SANDBOX_TEST_NETWORK must be "bridge" or "none".');
  const diskMb = String(env.QAFG_SANDBOX_DISK_MB ?? "3072").trim();
  if (!/^[1-9]\d{2,5}$/.test(diskMb)) throw sandboxError("QAFG_SANDBOX_DISK_MB must be a whole number of megabytes, 100 or more.");
  return { memory, cpus, testNetwork, diskBytes: Number(diskMb) * 1024 * 1024, maxEntries: 300_000 };
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The full `docker run` argument list for one phase. Pure, so the security flags can be tested.
export function dockerRunArgs({ name, workDir, env = {}, network, limits, command, uid, gid, containerCwd = "/work", image = SANDBOX_IMAGE }) {
  if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(name)) throw new Error("Invalid container name");
  // `--mount` takes comma-separated fields, so a comma in the path would inject extra options.
  if (!workDir || /[,\0\n\r]/.test(workDir)) throw new Error("Invalid work directory");
  if (network !== "bridge" && network !== "none") throw new Error("Invalid network mode");
  if (containerCwd !== "/work" && containerCwd !== "/") throw new Error("Invalid container directory");
  const args = [
    "run", "--rm", "--init",
    "--name", name,
    "--network", network,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,size=512m",
    "--pids-limit", "512",
    "--memory", limits.memory,
    "--memory-swap", limits.memory, // no swap beyond the memory cap
    "--cpus", limits.cpus,
    "--shm-size", "1g", // Chromium needs more than the 64 MB default
    "--mount", `type=bind,source=${workDir},target=/work`,
    "--workdir", containerCwd,
  ];
  // Run as the server's own user where the platform has one, so files in the work directory stay
  // owned by it. Docker Desktop on macOS and Windows does not need this.
  if (uid !== undefined && gid !== undefined) args.push("--user", `${uid}:${gid}`);
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_NAME.test(k)) throw new Error("Invalid environment variable name");
    args.push("--env", `${k}=${String(v)}`);
  }
  args.push(image, ...command);
  return args;
}

export function newContainerName() {
  return `qafg-${randomBytes(6).toString("hex")}`;
}

// Removing the container is not covered by the run scope's process kill: killing the `docker run`
// client does not stop the container it started. Always bypasses the scope, even for a cancelled run.
// Resolves true only when the daemon confirms the container is gone ("no such container" counts, since
// --rm may have removed it first); a bounded wait, a few retries, and false if it cannot be confirmed.
function removeOnce(name, timeoutMs) {
  return new Promise((resolve) => {
    const p = nodeSpawn("docker", ["rm", "-f", name], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); });
    const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } resolve(false); }, timeoutMs);
    p.on("error", () => { clearTimeout(timer); resolve(false); });
    p.on("close", (code) => { clearTimeout(timer); resolve(code === 0 || /no such container/i.test(err)); });
  });
}
export async function removeContainer(name, { attempts = 3, timeoutMs = 15_000, delayMs = 300 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (await removeOnce(name, timeoutMs)) return true;
    await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
  }
  console.error(`[sandbox] could not confirm removal of container ${name}`);
  return false;
}

// `docker image inspect` tells us whether Docker is reachable and the image has been built.
export function checkSandboxReady() {
  return new Promise((resolve, reject) => {
    const p = nodeSpawn("docker", ["image", "inspect", SANDBOX_IMAGE], { stdio: "ignore" });
    p.on("error", () => reject(sandboxError("Sandboxed runs need Docker, which was not found. Install Docker or set QAFG_SANDBOX=off.")));
    p.on("close", (code) => (code === 0
      ? resolve()
      : reject(sandboxError("The sandbox image is missing or Docker is not running. Start Docker and run `npm run sandbox:build`, or set QAFG_SANDBOX=off."))));
  });
}

// Size and entry count of a directory tree, without following links. Bounded: stops at maxEntries.
// Counts allocated blocks where the platform reports them, so sparse files are not undercounted.
export async function workspaceUsage(dir, { maxEntries = 300_000 } = {}) {
  let bytes = 0;
  let entries = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let names;
    try { names = await readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const ent of names) {
      if (++entries > maxEntries) return { bytes, entries, truncated: true };
      const full = join(d, ent.name);
      try {
        const st = await lstat(full);
        bytes += st.blocks !== undefined ? st.blocks * 512 : st.size;
        if (st.isDirectory()) stack.push(full);
      } catch { /* vanished while scanning */ }
    }
  }
  return { bytes, entries, truncated: false };
}

// Run one phase in a fresh container and resolve with its exit code. Output goes to onOutput.
// The container is removed afterwards and the removal is CONFIRMED before this settles; it is also
// registered with the run scope, so a run that hits its deadline waits for it too. The workspace is a
// host bind mount, so a watchdog stops the container if it grows past the disk or file-count limit.
export async function runPhase({ workDir, env, network, command, onOutput, limits = sandboxLimits(), timeoutMs, containerCwd, diskCheckMs = 2000 }) {
  const name = newContainerName();
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const gid = typeof process.getgid === "function" ? process.getgid() : undefined;
  const args = dockerRunArgs({ name, workDir, env, network, limits, command, uid, gid, containerCwd });
  const unregister = registerCleanup(() => removeContainer(name));
  let timer;
  let poll;
  let launched = false;
  try {
    return await new Promise((resolve, reject) => {
      const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
      proc.on("spawn", () => { launched = true; });
      proc.stdout.on("data", (d) => onOutput?.(d.toString()));
      proc.stderr.on("data", (d) => onOutput?.(d.toString()));
      proc.on("error", (e) => reject(e.code === "ENOENT" ? sandboxError("Docker was not found. Install Docker or set QAFG_SANDBOX=off.") : e));
      proc.on("close", (code) => resolve(code));
      if (timeoutMs) {
        timer = setTimeout(() => { removeContainer(name); reject(sandboxError(`The sandboxed step did not finish within ${Math.round(timeoutMs / 1000)} seconds and was stopped.`)); }, timeoutMs);
      }
      let checking = false;
      poll = setInterval(async () => {
        if (checking) return;
        checking = true;
        try {
          const u = await workspaceUsage(workDir, { maxEntries: limits.maxEntries });
          if (u.truncated || u.bytes > limits.diskBytes) {
            removeContainer(name);
            reject(sandboxError(`The sandboxed step wrote more than ${Math.round(limits.diskBytes / 1048576)} MB or ${limits.maxEntries} files to its workspace and was stopped.`));
          }
        } catch { /* a failed scan is retried on the next tick */ } finally { checking = false; }
      }, diskCheckMs);
    });
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
    if (launched) {
      const removed = await removeContainer(name);
      if (!removed) throw sandboxError("Could not confirm that the sandbox container was removed. Check `docker ps` for qafg-* containers and remove them.");
    }
    unregister();
  }
}

// Requirements are untrusted model output that is installed with network access. Only plain
// requirement lines are allowed: no pip options (index URLs, -e, -r, --find-links), URLs, VCS links
// or local paths. The install also uses wheels only (see the setup command in server.js).
const REQ_LINE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9._,-]+\])?\s*((===|==|>=|<=|~=|!=|>|<)\s*[A-Za-z0-9.*+!_-]+\s*,?\s*)*(;[^#\r\n]*)?$/;
export function validateRequirements(content) {
  if (typeof content !== "string" || !content.trim()) throw sandboxError("The sandbox needs a non-empty requirements.txt.");
  const lines = content.split(/\r?\n/);
  if (lines.length > 200) throw sandboxError("requirements.txt has too many lines for a sandboxed run.");
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (!REQ_LINE.test(line) || /:\/\/|@|\\/.test(line.split(";")[0])) {
      throw sandboxError(`requirements.txt contains a line the sandbox does not allow: "${line.slice(0, 60)}". Use plain "package" or "package>=1.0" lines.`);
    }
  }
}

// Inside the container "localhost" is the container itself, so a target on the host machine cannot
// be reached. Detect it up front instead of letting every test fail with a connection error.
const LOCAL_URL = /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)(?::\d+)?/i;
export function findLocalTarget(files) {
  for (const f of files) {
    if (/\.md$/i.test(f.name) || typeof f.content !== "string") continue;
    const m = f.content.match(LOCAL_URL);
    if (m) return m[0];
  }
  return null;
}

// The report is written by code running in the container, so the host treats it as hostile: open it
// without following a link, check the OPENED file is a regular file, cap the bytes read, and cap the
// shape of what is forwarded.
export async function readBoundedJson(path, { maxBytes = 5 * 1024 * 1024 } = {}) {
  const bad = () => sandboxError("The sandbox test report was missing or not safe to read, so it was not used.");
  try {
    if ((await lstat(path)).isSymbolicLink()) throw bad(); // also covers platforms without O_NOFOLLOW
  } catch (e) { throw e.code === "SANDBOX" ? e : bad(); }
  let fh;
  try {
    // O_NONBLOCK so a FIFO planted in its place cannot block the open; O_NOFOLLOW closes the race.
    fh = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  } catch { throw bad(); }
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.size > maxBytes) throw bad();
    const buf = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await fh.read(buf, 0, maxBytes + 1, 0);
    if (bytesRead > maxBytes) throw bad();
    try { return JSON.parse(buf.toString("utf8", 0, bytesRead)); } catch { throw bad(); }
  } finally { await fh.close().catch(() => {}); }
}

const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
// Force a normalised report into a bounded, well-typed shape before it is forwarded to the browser.
export function capReport(r, { maxTests = 2000, maxText = 20_000 } = {}) {
  const sm = r?.summary ?? {};
  let env = {};
  try { const j = JSON.stringify(r?.environment ?? {}); if (j.length <= 8192 && r?.environment && typeof r.environment === "object") env = JSON.parse(j); } catch { /* dropped */ }
  return {
    summary: { total: num(sm.total), passed: num(sm.passed), failed: num(sm.failed), error: num(sm.error), skipped: num(sm.skipped), duration: num(sm.duration) },
    tests: (Array.isArray(r?.tests) ? r.tests : []).slice(0, maxTests).map((t) => ({
      nodeid: clip(t?.nodeid, 500) ?? "",
      outcome: clip(t?.outcome, 20) ?? "",
      duration: num(t?.duration),
      setup: clip(t?.setup, 20) ?? undefined,
      call: clip(t?.call, 20) ?? undefined,
      teardown: clip(t?.teardown, 20) ?? undefined,
      error: clip(typeof t?.error === "string" ? t.error : t?.error == null ? null : JSON.stringify(t.error), maxText),
      stdout: clip(t?.stdout, maxText),
      stderr: clip(t?.stderr, maxText),
    })),
    environment: env,
    created: typeof r?.created === "number" && Number.isFinite(r.created) ? r.created : undefined,
  };
}

export const SANDBOX_PHASE_TIMEOUT_MS = () => envInt("QAFG_SANDBOX_PHASE_TIMEOUT_MS", 600_000, { max: MAX_TIMER_MS });
