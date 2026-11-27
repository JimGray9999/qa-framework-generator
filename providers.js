import Anthropic from "@anthropic-ai/sdk";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resolveClaudeBin, spawnClaude } from "./claudeBin.js";
import { isolatedClaudeSpec } from "./claudeIsolation.js";
import { envInt, MAX_TIMER_MS } from "./config.js";
import { killTree, markOwnGroup } from "./processScope.js";

// Errors the user can act on (missing key, CLI not installed) are safe to show verbatim.
function exposed(message) {
  const err = new Error(message);
  err.expose = true;
  return err;
}

const SYSTEM_PROMPT = `You are a code generation assistant that outputs ONLY valid JSON.

CRITICAL RULES FOR VALID JSON:
1. All strings must use double quotes
2. Inside string values, escape double quotes as \\"
3. Inside string values, escape newlines as \\n
4. Inside string values, escape backslashes as \\\\
5. No trailing commas
6. No comments
7. Keep code CONCISE - no lengthy docstrings, minimal comments

Your entire response must be a single valid JSON object, nothing else.`;

async function callAnthropicAPI({ apiKey, userPrompt, system = SYSTEM_PROMPT }) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw exposed("No Anthropic API key provided. Enter one in Settings or choose a different provider.");
  const client = new Anthropic({ apiKey: key });
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: userPrompt }]
  });
  return message.content[0].text;
}

async function callOpenAICompatible({ apiKey, userPrompt, model, url, providerLabel, system = SYSTEM_PROMPT }) {
  if (!apiKey) throw exposed(`No ${providerLabel} API key provided. Enter one in Settings or choose a different provider.`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt }
      ]
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`${providerLabel} API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callOpenAI({ apiKey, userPrompt, model = "gpt-4o", system }) {
  return callOpenAICompatible({
    apiKey: apiKey || process.env.OPENAI_API_KEY,
    userPrompt, model, system,
    url: "https://api.openai.com/v1/chat/completions",
    providerLabel: "OpenAI"
  });
}

async function callGrok({ apiKey, userPrompt, model = "grok-2-latest", system }) {
  return callOpenAICompatible({
    apiKey: apiKey || process.env.XAI_API_KEY || process.env.GROK_API_KEY,
    userPrompt, model, system,
    url: "https://api.x.ai/v1/chat/completions",
    providerLabel: "Grok (xAI)"
  });
}

async function callPerplexity({ apiKey, userPrompt, model = "sonar-pro", system }) {
  return callOpenAICompatible({
    apiKey: apiKey || process.env.PERPLEXITY_API_KEY,
    userPrompt, model, system,
    url: "https://api.perplexity.ai/chat/completions",
    providerLabel: "Perplexity"
  });
}

// Calls the locally installed Claude Code CLI (`claude -p`) which uses the user's
// logged-in session — no API key required.
async function callClaudeLocal({ userPrompt, system = SYSTEM_PROMPT, isolated = false }) {
  const claudeBin = resolveClaudeBin();
  // Isolated mode (untrusted source-derived prompts): no tools, MCP servers or hooks, an
  // allow-listed environment and an empty scratch directory (see claudeIsolation.js).
  // Anything else is launched exactly as before.
  let args = ["-p", "--output-format", "text"];
  let childEnv;
  let cwd;
  if (isolated) {
    const spec = isolatedClaudeSpec({ bin: claudeBin });
    args = spec.args;
    childEnv = spec.env;
    cwd = await mkdtemp(join(tmpdir(), "qafg-claude-"));
  } else {
    // Strip ANTHROPIC_API_KEY from env so claude uses the subscription login
    // instead of falling back to API-key billing (which may be out of credits).
    childEnv = { ...process.env };
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.ANTHROPIC_AUTH_TOKEN;
  }
  try {
    return await new Promise((resolve, reject) => {
      const fullPrompt = `${system}\n\n${userPrompt}`;
      console.log(`[claude-local] using binary: ${claudeBin}${isolated ? " (isolated: no tools, MCP or hooks)" : ""}`);
      const proc = spawnClaude(claudeBin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: childEnv,
        ...(cwd ? { cwd } : {}),
        // POSIX: own process group, so a timeout can stop the CLI and anything it started.
        // (Windows uses taskkill /T, which covers the cmd.exe shell of a .cmd wrapper.)
        detached: process.platform !== "win32",
      });
      markOwnGroup(proc);
      let stdout = "";
      let stderr = "";
      // A CLI that never answers (stalled network, a prompt it cannot act on) must not pin the
      // request, the process and the scratch directory forever.
      const timeoutMs = envInt("QAFG_CLAUDE_TIMEOUT_MS", 300_000, { max: MAX_TIMER_MS });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        // Stop the whole process tree and wait until it is confirmed gone BEFORE rejecting: the
        // caller's `finally` removes the scratch directory, which must not race a live process.
        killTree(proc).then(() => reject(exposed(`The local Claude CLI did not respond within ${Math.round(timeoutMs / 1000)} seconds and was stopped. Try again, or choose a different provider.`)));
      }, timeoutMs);
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", (err) => {
        if (timedOut) return;
        clearTimeout(timer);
        if (err.code === "ENOENT") {
          reject(exposed("Local Claude CLI not found. Install Claude Code (https://claude.com/claude-code), set CLAUDE_BIN to its full path, or pick a different provider."));
        } else {
          reject(err);
        }
      });
      proc.on("close", (code) => {
        if (timedOut) return;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`claude CLI exited ${code}: ${stderr || stdout}`));
        } else {
          resolve(stdout);
        }
      });
      // If the CLI exits immediately (not logged in, bad binary) writing to its stdin raises
      // EPIPE; swallow it so the "close" handler reports the CLI's real error instead of
      // the unhandled stream error taking the whole server down.
      proc.stdin.on("error", () => {});
      proc.stdin.write(fullPrompt);
      proc.stdin.end();
    });
  } finally {
    if (cwd) await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

// `isolated` marks a prompt that contains untrusted content (repository source). Only the
// local Claude CLI needs special handling; the API providers are tool-free by construction.
export async function generateWithProvider({ provider, apiKey, userPrompt, model, system, isolated = false }) {
  switch ((provider || "anthropic-api").toLowerCase()) {
    case "claude-local":
      return await callClaudeLocal({ userPrompt, system, isolated });
    case "openai":
      return await callOpenAI({ apiKey, userPrompt, model, system });
    case "grok":
      return await callGrok({ apiKey, userPrompt, model, system });
    case "perplexity":
      return await callPerplexity({ apiKey, userPrompt, model, system });
    case "anthropic-api":
    default:
      return await callAnthropicAPI({ apiKey, userPrompt, system });
  }
}

export async function detectProviders() {
  const claudeLocal = await new Promise((resolve) => {
    const bin = resolveClaudeBin();
    const proc = spawnClaude(bin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
  return {
    "claude-local": { available: claudeLocal, requiresKey: false, label: "Claude (Local CLI)" },
    "anthropic-api": { available: true, requiresKey: true, hasEnvKey: !!process.env.ANTHROPIC_API_KEY, label: "Anthropic API (Claude)" },
    "openai": { available: true, requiresKey: true, hasEnvKey: !!process.env.OPENAI_API_KEY, label: "OpenAI (ChatGPT)" },
    "grok": { available: true, requiresKey: true, hasEnvKey: !!(process.env.XAI_API_KEY || process.env.GROK_API_KEY), label: "Grok (xAI)" },
    "perplexity": { available: true, requiresKey: true, hasEnvKey: !!process.env.PERPLEXITY_API_KEY, label: "Perplexity" }
  };
}
