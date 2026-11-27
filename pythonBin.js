import { spawn as nodeSpawn } from "child_process";

// Find a working Python 3 interpreter to create the venv with.
//
// A hard-coded `python3` fails on Windows: there it is usually the Microsoft Store
// placeholder (in %LOCALAPPDATA%\Microsoft\WindowsApps), which exists as a file but only
// prints "Python was not found..." and exits with code 9009. Real installs answer to
// `python` or the `py -3` launcher. So each candidate is probed (`--version` must exit 0
// and report Python 3.x) instead of trusting that a file with that name exists.
//
// Candidates are [command, ...args] arrays. Override with QAFG_PYTHON=/path/to/python.

export function pythonCandidates({ platform = process.platform, docker = false, env = process.env } = {}) {
  const defaults = platform === "win32"
    ? [["python"], ["py", "-3"], ["python3"]]
    : docker
      ? [["python"], ["python3"]]
      : [["python3"], ["python"]];
  return env.QAFG_PYTHON ? [[env.QAFG_PYTHON], ...defaults] : defaults;
}

export function probePython(command, args = [], timeoutMs = 5000) {
  return new Promise((resolve) => {
    let output = "";
    let child;
    try {
      child = nodeSpawn(command, [...args, "--version"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch {
      return resolve({ code: -1, output: "" });
    }
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d)); // Python 2 prints its version on stderr
    child.on("error", () => { clearTimeout(timer); resolve({ code: -1, output: "" }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
}

let cached = null; // only a success is cached, so installing Python needs no server restart

export async function resolvePython({ probe = probePython, candidates = pythonCandidates(), useCache = true } = {}) {
  if (useCache && cached) return cached;
  for (const [command, ...args] of candidates) {
    const { code, output } = await probe(command, args);
    if (code === 0 && /^Python 3\./m.test(output)) {
      if (useCache) cached = [command, ...args];
      return [command, ...args];
    }
  }
  return null;
}

export const PYTHON_NOT_FOUND_MESSAGE =
  "Python 3 was not found. Install it from https://www.python.org/downloads/ (tick \"Add python.exe to PATH\" on Windows), " +
  "or set QAFG_PYTHON to the full path of a Python 3 interpreter, then try again.";
