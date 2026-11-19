import { runAgent, asArray, str, need } from "./runAgent.js";

const SYSTEM = `You are the Test Planner Agent, a senior QA engineer.
You design a risk-based test plan for a website from real page analysis data. You do not write code.
Output ONLY a single valid JSON object.`;

const PRIORITIES = ["P0", "P1", "P2"];

export async function runTestPlanner({ request, pageAnalysis, generate, provider, apiKey, onEvent }) {
  const prompt = `Create a test plan for ${request.targetUrl}.
Automation stack that will implement it: ${request.language} + ${request.framework}.
User focus areas: ${request.focus.join("; ") || "none stated, use your judgment"}.

${pageAnalysis}

Rules:
- 4 to 6 scenarios, ordered by priority. Prefer a mix: smoke, functional, negative, navigation.
- Only plan what is verifiable from the page analysis above. Do not assume features, credentials, or elements that were not detected.
- Do not plan interaction with cookie banners or modals.
- Each scenario must be automatable in a single short test with clear assertions.

JSON format:
{"summary":"1-2 sentences on what the site is and the testing approach",
 "risks":["top product/quality risks, max 4"],
 "scenarios":[{"id":"TC-01","title":"","priority":"P0|P1|P2","type":"smoke|functional|negative|navigation","steps":["..."],"expected":"..."}],
 "outOfScope":["things deliberately not covered, max 4"]}`;

  return runAgent({
    name: "test-planner",
    system: SYSTEM,
    prompt,
    generate,
    provider,
    apiKey,
    onEvent,
    validate: (o) => {
      const scenarios = asArray(o.scenarios).slice(0, 8).map((s, i) => ({
        id: str(s.id, 20) || `TC-${String(i + 1).padStart(2, "0")}`,
        title: str(s.title, 200),
        priority: PRIORITIES.includes(s.priority) ? s.priority : "P1",
        type: str(s.type, 30) || "functional",
        steps: asArray(s.steps).slice(0, 10).map((x) => str(x, 300)),
        expected: str(s.expected, 400),
      }));
      need(scenarios.length >= 1 && scenarios.every((s) => s.title && s.steps.length && s.expected), "each scenario needs title, steps and expected");
      return {
        summary: str(o.summary, 600),
        risks: asArray(o.risks).slice(0, 4).map((x) => str(x, 300)),
        scenarios,
        outOfScope: asArray(o.outOfScope).slice(0, 4).map((x) => str(x, 300)),
      };
    },
  });
}
