import { extractJSON } from "./json.js";
import { agentError } from "./catalog.js";

// Shared agent runner: one model call that must return JSON passing `validate`.
// On a parse or validation failure it retries once, feeding the error back so the
// model can correct itself (a small but real "agentic" self-repair loop).
export async function runAgent({ name, system, prompt, generate, provider, apiKey, validate, retries = 1, onEvent }) {
  let lastError;
  let currentPrompt = prompt;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const text = await generate({ provider, apiKey, userPrompt: currentPrompt, system });
    try {
      const parsed = validate(extractJSON(text));
      onEvent?.({ agent: name, attempt, ok: true });
      return parsed;
    } catch (err) {
      lastError = err;
      onEvent?.({ agent: name, attempt, ok: false, error: err.message });
      currentPrompt = `${prompt}\n\nYour previous response was rejected: ${err.message}\nReturn ONLY corrected, valid JSON.`;
    }
  }
  console.error(`[agent:${name}] failed after retry:`, lastError?.message);
  throw agentError(`The ${name} agent returned output that failed validation. Try again.`);
}

export const asArray = (v) => (Array.isArray(v) ? v : []);
export const str = (v, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
export function need(cond, message) {
  if (!cond) throw new Error(message);
}
