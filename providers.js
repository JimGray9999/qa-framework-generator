import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const candidates = [
    join(homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    join(homedir(), ".claude/local/claude")
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return "claude"; // fall back to PATH
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

async function callAnthropicAPI({ apiKey, userPrompt }) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("No Anthropic API key provided. Enter one in Settings or choose a different provider.");
  const client = new Anthropic({ apiKey: key });
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }]
  });
  return message.content[0].text;
}

async function callOpenAICompatible({ apiKey, userPrompt, model, url, providerLabel }) {
  if (!apiKey) throw new Error(`No ${providerLabel} API key provided. Enter one in Settings or choose a different provider.`);
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
        { role: "system", content: SYSTEM_PROMPT },
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

async function callOpenAI({ apiKey, userPrompt, model = "gpt-4o" }) {
  return callOpenAICompatible({
    apiKey: apiKey || process.env.OPENAI_API_KEY,
    userPrompt, model,
    url: "https://api.openai.com/v1/chat/completions",
    providerLabel: "OpenAI"
  });
}

async function callGrok({ apiKey, userPrompt, model = "grok-2-latest" }) {
  return callOpenAICompatible({
    apiKey: apiKey || process.env.XAI_API_KEY || process.env.GROK_API_KEY,
    userPrompt, model,
    url: "https://api.x.ai/v1/chat/completions",
    providerLabel: "Grok (xAI)"
  });
}

async function callPerplexity({ apiKey, userPrompt, model = "sonar-pro" }) {
  return callOpenAICompatible({
    apiKey: apiKey || process.env.PERPLEXITY_API_KEY,
    userPrompt, model,
    url: "https://api.perplexity.ai/chat/completions",
    providerLabel: "Perplexity"
  });
}

// Calls the locally installed Claude Code CLI (`claude -p`) which uses the user's
// logged-in session — no API key required.
async function callClaudeLocal({ userPrompt }) {
  const claudeBin = resolveClaudeBin();
  return await new Promise((resolve, reject) => {
    const fullPrompt = `${SYSTEM_PROMPT}\n\n${userPrompt}`;
    console.log(`[claude-local] using binary: ${claudeBin}`);
    // Strip ANTHROPIC_API_KEY from env so claude uses the subscription login
    // instead of falling back to API-key billing (which may be out of credits).
    const childEnv = { ...process.env };
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.ANTHROPIC_AUTH_TOKEN;
    const proc = spawn(claudeBin, ["-p", "--output-format", "text"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error("Local Claude CLI not found. Install Claude Code (https://claude.com/claude-code) or pick a different provider."));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr || stdout}`));
      } else {
        resolve(stdout);
      }
    });
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  });
}

export async function generateWithProvider({ provider, apiKey, userPrompt, model }) {
  switch ((provider || "anthropic-api").toLowerCase()) {
    case "claude-local":
      return await callClaudeLocal({ userPrompt });
    case "openai":
      return await callOpenAI({ apiKey, userPrompt, model });
    case "grok":
      return await callGrok({ apiKey, userPrompt, model });
    case "perplexity":
      return await callPerplexity({ apiKey, userPrompt, model });
    case "anthropic-api":
    default:
      return await callAnthropicAPI({ apiKey, userPrompt });
  }
}

export async function detectProviders() {
  const claudeLocal = await new Promise((resolve) => {
    const bin = resolveClaudeBin();
    const proc = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
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
