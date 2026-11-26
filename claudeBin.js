import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import path from "path";

// Locate the Claude Code CLI. Order: CLAUDE_BIN, well-known install locations, then
// (on Windows) a manual PATH search that understands .exe/.cmd/.bat, finally the bare
// name "claude" so the OS can try its own PATH lookup.
// Parameters are injectable so the lookup can be tested for either platform.
export function resolveClaudeBin({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  home = homedir(),
} = {}) {
  const win = platform === "win32";
  const p = win ? path.win32 : path.posix;

  if (env.CLAUDE_BIN && exists(env.CLAUDE_BIN)) return env.CLAUDE_BIN;

  const candidates = win
    ? [
        p.join(home, ".local", "bin", "claude.exe"),
        p.join(home, ".claude", "local", "claude.exe"),
        env.APPDATA && p.join(env.APPDATA, "npm", "claude.cmd"), // npm global install
      ]
    : [
        p.join(home, ".local/bin/claude"),
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
        p.join(home, ".claude/local/claude"),
      ];
  for (const c of candidates.filter(Boolean)) if (exists(c)) return c;

  if (win) {
    // Node's spawn() on Windows only auto-resolves .exe, so walk PATH ourselves.
    const dirs = (env.PATH ?? env.Path ?? "").split(p.delimiter).filter(Boolean);
    for (const dir of dirs) {
      for (const ext of [".exe", ".cmd", ".bat"]) {
        const full = p.join(dir, "claude" + ext);
        if (exists(full)) return full;
      }
    }
  }
  return "claude";
}

// .cmd/.bat wrappers (what `npm i -g` creates on Windows) cannot be spawned directly:
// they need a shell. The args passed here are fixed constants and the prompt travels
// over stdin, so building the command string by hand is safe.
export function spawnClaude(bin, args, options, platform = process.platform) {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    return spawn(`"${bin}" ${args.join(" ")}`, { ...options, shell: true });
  }
  return spawn(bin, args, options);
}
