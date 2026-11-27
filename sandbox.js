import { spawn as nodeSpawn } from "child_process";
import { randomBytes } from "crypto";
import { spawn } from "./processScope.js";
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
  return { memory, cpus, testNetwork };
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The full `docker run` argument list for one phase. Pure, so the security flags can be tested.
export function dockerRunArgs({ name, workDir, env = {}, network, limits, command, uid, gid, image = SANDBOX_IMAGE }) {
  if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(name)) throw new Error("Invalid container name");
  // `--mount` takes comma-separated fields, so a comma in the path would inject extra options.
  if (!workDir || /[,\0\n\r]/.test(workDir)) throw new Error("Invalid work directory");
  if (network !== "bridge" && network !== "none") throw new Error("Invalid network mode");
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
    "--workdir", "/work",
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
export function removeContainer(name) {
  return new Promise((resolve) => {
    const p = nodeSpawn("docker", ["rm", "-f", name], { stdio: "ignore" });
    p.on("error", () => resolve());
    p.on("close", () => resolve());
  });
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

// Run one phase in a fresh container and resolve with its exit code. Output goes to onOutput.
// The container is always removed afterwards.
export async function runPhase({ workDir, env, network, command, onOutput, limits = sandboxLimits(), timeoutMs }) {
  const name = newContainerName();
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const gid = typeof process.getgid === "function" ? process.getgid() : undefined;
  const args = dockerRunArgs({ name, workDir, env, network, limits, command, uid, gid });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
      proc.stdout.on("data", (d) => onOutput?.(d.toString()));
      proc.stderr.on("data", (d) => onOutput?.(d.toString()));
      proc.on("error", (e) => reject(e.code === "ENOENT" ? sandboxError("Docker was not found. Install Docker or set QAFG_SANDBOX=off.") : e));
      proc.on("close", (code) => resolve(code));
      if (timeoutMs) {
        timer = setTimeout(() => { removeContainer(name); reject(sandboxError(`The sandboxed step did not finish within ${Math.round(timeoutMs / 1000)} seconds and was stopped.`)); }, timeoutMs);
      }
    });
  } finally {
    clearTimeout(timer);
    await removeContainer(name);
  }
}

export const SANDBOX_PHASE_TIMEOUT_MS = () => envInt("QAFG_SANDBOX_PHASE_TIMEOUT_MS", 600_000, { max: MAX_TIMER_MS });
