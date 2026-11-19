import { FRAMEWORKS, VALIDATED, normalizeRequest } from "./catalog.js";
import { runAgent, str, need } from "./runAgent.js";

const SYSTEM = `You are the Intake Agent of a QA automation framework generator.
Your only job: turn a user's free-text request into a structured generation request, asking at most one short follow-up question when something essential is missing or unsupported.
Output ONLY a single valid JSON object. Never write code or test plans.`;

export async function runIntake({ messages, generate, provider, apiKey, onEvent }) {
  const transcript = messages
    .slice(-12)
    .map((m) => `${m.role === "assistant" ? "AGENT" : "USER"}: ${str(m.content, 1500)}`)
    .join("\n");

  const matrix = Object.entries(FRAMEWORKS).map(([l, f]) => `- ${l}: ${f.join(", ")}`).join("\n");

  const prompt = `Conversation so far:
${transcript}

Supported language -> framework options:
${matrix}
Only "${[...VALIDATED].join(", ")}" is validated end to end; the others are experimental. If the user picks an experimental one, still accept it but mention that in "reply".

Defaults you may apply and must state in "reply": framework "playwright" if unspecified; language "python" only if the user clearly does not care.
The target URL is required. Never invent one. If it is missing, or the language is ambiguous, ask ONE question and return status "needs_info".
"focus" is a short list of user priorities (e.g. "login flow", "checkout"); empty if none.

JSON format:
{"status":"ready"|"needs_info","reply":"short message to the user","request":{"language":"","framework":"","targetUrl":"","focus":[]}}
When status is "needs_info", "request" may contain whatever is known so far.`;

  return runAgent({
    name: "intake",
    system: SYSTEM,
    prompt,
    generate,
    provider,
    apiKey,
    onEvent,
    validate: (o) => {
      need(o && (o.status === "ready" || o.status === "needs_info"), 'status must be "ready" or "needs_info"');
      const reply = str(o.reply, 800);
      need(reply, "reply is required");
      if (o.status === "needs_info") return { status: "needs_info", reply, request: o.request || {} };
      // Server-side allow-list: the model's output is never trusted into later prompts as-is.
      return { status: "ready", reply, request: normalizeRequest(o.request) };
    },
  });
}
