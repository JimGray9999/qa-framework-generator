import { runAgent, asArray, str, need } from "./runAgent.js";

export async function runEngineer({ request, testPlan, architecture, pageAnalysis, langPrompt, generate, provider, apiKey, onEvent }) {
  const plan = testPlan.scenarios
    .map((s) => `${s.id} [${s.priority}] ${s.title}\n  steps: ${s.steps.join(" -> ")}\n  expected: ${s.expected}`)
    .join("\n");
  const files = architecture.files.map((f) => `- ${f.path}${f.name} (${f.kind}): ${f.purpose}`).join("\n");
  const pos = architecture.pageObjects
    .map((p) => `- ${p.name} in ${p.file}: ${p.responsibilities}; methods: ${p.methods.join(", ")}; selectors: ${p.selectors.join(", ") || "defensive only"}`)
    .join("\n");
  const map = architecture.scenarioMap.map((m) => `- ${m.scenarioId} -> ${m.testFile} :: ${m.testName} (uses ${m.pageObjects.join(", ")})`).join("\n");

  const prompt = `You are the Automation Engineer Agent. Implement the approved architecture exactly.

Target: ${request.targetUrl}  Stack: ${request.language} + ${request.framework}

${pageAnalysis}

APPROVED TEST PLAN (implement every scenario; this overrides any test count in the file list below):
${plan}

APPROVED ARCHITECTURE
Approach: ${architecture.approach}
Files to produce (use these exact names and paths):
${files}
Page objects:
${pos}
Fixtures: ${architecture.fixtures.join("; ") || "none"}
Scenario to test mapping:
${map}

STACK REQUIREMENTS (dependency, config and README conventions that must be honored):
${langPrompt.fileList}

README.md must cover, for ${request.language} + ${request.framework}: title, prerequisites, install commands, run command, browser/headed toggle matching the generated code, and a short project tree. Commands MUST match the generated code. Keep it under ~60 lines.

${langPrompt.rules}

Name each test after its scenario id and title so results trace back to the plan.

JSON FORMAT:
{"files":[{"name":"filename","path":"folder/","content":"code"}],"summary":"description"}

Use \\n for newlines, \\" for quotes. Output ONLY valid JSON.`;

  const result = await runAgent({
    name: "automation-engineer",
    system: undefined, // provider default: strict JSON-only prompt
    prompt,
    generate,
    provider,
    apiKey,
    onEvent,
    validate: (o) => {
      const out = asArray(o.files).map((f) => ({ name: str(f.name, 160), path: str(f.path, 300), content: typeof f.content === "string" ? f.content : "" }));
      need(out.length >= 3 && out.every((f) => f.name && f.content), "files must be a non-empty list of {name, path, content}");
      return { files: out, summary: str(o.summary, 1000) };
    },
  });

  // Traceability check: tell the user if the engineer deviated from the architecture.
  const produced = new Set(result.files.map((f) => `${f.path || ""}${f.name}`));
  result.warnings = architecture.files
    .map((f) => `${f.path || ""}${f.name}`)
    .filter((p) => !produced.has(p))
    .map((p) => `Planned file not generated: ${p}`);
  return result;
}
