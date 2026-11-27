import { spawn, killTree, assertNotCancelled } from "./processScope.js";

// Find working Python 3 interpreters to create the venv with.
//
// 1. A hard-coded `python3` fails on Windows: there it is usually the Microsoft Store
//    placeholder, which exists as a file but only prints "Python was not found" and exits
//    with code 9009. Real installs answer to `python` or the `py -3` launcher. So every
//    candidate is probed instead of trusting that a file with that name exists.
// 2. The probe asks the interpreter for its own absolute path (sys.executable) and only
//    that path is used afterwards. A bare command can resolve differently depending on
//    the working directory (Windows searches the current directory first), and venv
//    creation runs in the generated-files directory, so probe and launch could disagree.
// 3. A Python can report its version fine and still be unable to create a venv (e.g.
//    Debian/Ubuntu without python3-venv). All working interpreters are returned, and the
//    caller falls back to the next one if venv creation fails (createVenvWithFallback).
//
// Probes use the run-scoped spawn, so a run deadline kills them and a cancelled run stops
// probing. Override the first candidate with QAFG_PYTHON=/path/to/python.

export function pythonCandidates({ platform = process.platform, docker = false, env = process.env } = {}) {
  const defaults = platform === "win32"
    ? [["python"], ["py", "-3"], ["python3"]]
    : docker
      ? [["python"], ["python3"]]
      : [["python3"], ["python"]];
  return env.QAFG_PYTHON ? [[env.QAFG_PYTHON], ...defaults] : defaults;
}

// Prints e.g. "QAFG 3 C:\Python314\python.exe". Python 2's print statement-as-function
// would print a tuple instead, so the pattern below also rejects Python 2.
const PROBE_SCRIPT = "import sys; print('QAFG', sys.version_info[0], sys.executable)";
const PROBE_RE = /^QAFG 3 (.+)$/m;
const isAbsolutePath = (p) => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p);

export function probePython(command, args = [], timeoutMs = 5000) {
  assertNotCancelled(); // a cancelled run must not start another probe (propagates)
  return new Promise((resolve) => {
    let output = "";
    let child;
    try {
      child = spawn(command, [...args, "-c", PROBE_SCRIPT], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      if (/cancelled/.test(err.message)) throw err;
      return resolve({ code: -1, output: "" });
    }
    const timer = setTimeout(() => { killTree(child); }, timeoutMs);
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", () => { clearTimeout(timer); resolve({ code: -1, output: "" }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
}

let cached = null; // only a non-empty result is cached, so installing Python needs no restart

export function clearPythonCache() { cached = null; }

// Returns absolute interpreter paths, in candidate order, without duplicates (`python` and
// `py -3` often resolve to the same file). Empty array if none work.
export async function findPythons({ probe = probePython, candidates = pythonCandidates(), useCache = true } = {}) {
  if (useCache && cached) return cached;
  const found = [];
  for (const [command, ...args] of candidates) {
    assertNotCancelled();
    const { code, output } = await probe(command, args);
    const exe = code === 0 ? PROBE_RE.exec(output)?.[1].trim() : null;
    if (exe && isAbsolutePath(exe) && !found.includes(exe)) found.push(exe);
  }
  if (useCache && found.length) cached = found;
  return found;
}

// Try each interpreter in turn; a failed attempt is cleaned up before the next. Resolves
// to the interpreter that worked. Throws an error carrying `.failures` if none did, and
// rethrows anything else (e.g. a cancelled run) untouched.
export async function createVenvWithFallback({ pythons, venvPath, cwd, spawn: spawnFn = spawn, rm }) {
  const failures = [];
  for (const python of pythons) {
    assertNotCancelled();
    const child = spawnFn(python, ["-m", "venv", venvPath], { cwd });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d));
    const code = await new Promise((resolve) => {
      child.on("close", resolve);
      child.on("error", () => resolve(-1));
    });
    if (code === 0) return python;
    failures.push({ python, code, detail: stderr.trim().slice(-300) });
    await rm(venvPath, { recursive: true, force: true }).catch(() => {});
  }
  const err = new Error(
    "Could not create a virtual environment with any Python 3 interpreter: " +
    failures.map((f) => `${f.python} (exit ${f.code}${f.detail ? `: ${f.detail}` : ""})`).join("; ")
  );
  err.failures = failures;
  throw err;
}

export const PYTHON_NOT_FOUND_MESSAGE =
  "Python 3 was not found. Install it from https://www.python.org/downloads/ (tick \"Add python.exe to PATH\" on Windows), " +
  "or set QAFG_PYTHON to the full path of a Python 3 interpreter, then try again.";

export const VENV_FAILED_MESSAGE =
  "Python 3 was found, but it could not create a virtual environment. On Debian/Ubuntu install the python3-venv package; " +
  "otherwise install a full Python from https://www.python.org/downloads/ or set QAFG_PYTHON to a different interpreter. Details are in the server log.";
