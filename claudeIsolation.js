// Isolated ("text-only") launch of the local Claude Code CLI, for prompts that contain
// untrusted content (repository source). Prompt instructions cannot enforce a boundary, so
// the session itself is stripped of everything an injected instruction could use:
//
//   --tools ""                 no built-in tools (no file reads, no shell, no web)
//   --strict-mcp-config        no MCP servers (none are passed, so none are loaded)
//   --disable-slash-commands   no skills or commands
//   --no-session-persistence   nothing saved to disk
//   --settings {"disableAllHooks":true}   settings hooks (user and project) do not run
//
// plus an empty scratch working directory and an allow-listed environment. (--bare would
// skip hooks too, but it disables subscription login, which claude-local relies on.)
// The flags are documented in `claude --help`, and their effect was verified against the
// installed CLI: user-level and project-level hooks and MCP servers all ran under the
// default flags and none ran under these.
//
// API providers (Anthropic, OpenAI, ...) are plain chat-completion calls with no tools, so
// they need no such treatment.

export const ISOLATED_ARGS = [
  "-p", "--output-format", "text",
  "--tools", "",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--no-session-persistence",
  "--settings", '{"disableAllHooks":true}',
];

// Environment variables the CLI needs to start, find its login and reach the network.
// Everything else (server tokens, API keys, cloud credentials) is dropped.
const KEEP = [
  "PATH", "PATHEXT", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
  "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "USER", "USERNAME", "LOGNAME", "SHELL",
  "LANG", "LANGUAGE", "TERM", "TZ", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE",
  "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN",
];
const KEEP_PREFIXES = ["LC_"];
// Never passed, even if listed in QAFG_CLAUDE_ENV_PASSTHROUGH: claude-local must use the
// subscription login, not API-key billing.
const NEVER = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]);

export function buildIsolatedEnv(env = process.env, platform = process.platform) {
  const fold = (s) => (platform === "win32" ? s.toUpperCase() : s);
  const extra = String(env.QAFG_CLAUDE_ENV_PASSTHROUGH || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allow = new Set([...KEEP, ...extra].map(fold));
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || NEVER.has(fold(k).toUpperCase())) continue;
    const key = fold(k);
    if (allow.has(key) || allow.has(key.toUpperCase()) || allow.has(key.toLowerCase()) ||
        KEEP_PREFIXES.some((p) => key.toUpperCase().startsWith(p)) ||
        // proxy variables are conventionally lowercase on POSIX
        ["http_proxy", "https_proxy", "no_proxy", "all_proxy"].includes(k)) {
      out[k] = v;
    }
  }
  return out;
}

// Arguments and environment for an isolated run. Fails closed where the lockdown cannot be
// guaranteed: on Windows a .cmd/.bat wrapper has to run through a shell, and the empty
// `--tools ""` and the JSON `--settings` argument cannot be quoted reliably there.
export function isolatedClaudeSpec({ bin, platform = process.platform, env = process.env } = {}) {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    const err = new Error(
      "Analyzing source code needs an isolated, tool-free Claude session, which is not supported through the npm .cmd wrapper on Windows. " +
      "Install the native Claude Code (claude.exe) and set CLAUDE_BIN to it, or choose the Anthropic API or OpenAI provider in Settings."
    );
    err.expose = true;
    throw err;
  }
  return { args: [...ISOLATED_ARGS], env: buildIsolatedEnv(env, platform) };
}
