import { runAgent, asArray, str, need } from "./runAgent.js";
import { repoContextToPrompt } from "./repoAnalyst.js";

const SYSTEM = `You are the Framework Architect Agent.
Given an approved test plan, you design the structure of the automation framework: files, page objects, fixtures, and how each scenario maps to a test. You do not write implementation code.
Output ONLY a single valid JSON object.`;

export function validateArchitecture(o, testPlan) {
  const files = asArray(o.files).slice(0, 25).map((f) => ({
    path: str(f.path, 200),
    name: str(f.name, 120),
    kind: str(f.kind, 20) || "config",
    purpose: str(f.purpose, 300),
  }));
  need(files.length >= 3 && files.every((f) => f.name), "files must be a list with names");
  need(files.some((f) => /readme/i.test(f.name)), "files must include a README.md");
  const scenarioMap = asArray(o.scenarioMap).map((m) => ({
    scenarioId: str(m.scenarioId, 20),
    testFile: str(m.testFile, 160),
    testName: str(m.testName, 160),
    pageObjects: asArray(m.pageObjects).map((p) => str(p, 80)),
  }));
  const mapped = new Set(scenarioMap.map((m) => m.scenarioId));
  const missing = testPlan.scenarios.filter((s) => !mapped.has(s.id)).map((s) => s.id);
  need(missing.length === 0, `scenarioMap is missing: ${missing.join(", ")}`);
  return {
    approach: str(o.approach, 800),
    files,
    pageObjects: asArray(o.pageObjects).slice(0, 6).map((p) => ({
      name: str(p.name, 80),
      file: str(p.file, 160),
      responsibilities: str(p.responsibilities, 300),
      methods: asArray(p.methods).slice(0, 12).map((x) => str(x, 80)),
      selectors: asArray(p.selectors).slice(0, 12).map((x) => str(x, 120)),
    })),
    fixtures: asArray(o.fixtures).slice(0, 6).map((x) => str(x, 200)),
    scenarioMap,
  };
}

export async function runArchitect({ request, testPlan, pageAnalysis, repoContext, requiredFiles, generate, provider, apiKey, onEvent }) {
  const scenarios = testPlan.scenarios.map((s) => `${s.id} [${s.priority}] ${s.title}`).join("\n");
  const prompt = `Design the ${request.language} + ${request.framework} framework for ${request.targetUrl}.

Approved scenarios (every one must be mapped to exactly one test):
${scenarios}

${pageAnalysis}

${repoContextToPrompt(repoContext)}

Required deliverables and conventions for this stack (your file list must satisfy these):
${requiredFiles}

Rules:
- Page Object Model; 2-3 page objects. Keep the scaffold lean, no base page class.
- Group tests into 2-3 test files. Use idiomatic file/dir naming for ${request.language}.
- Every file in "files" needs a one-line purpose. Include README.md and the dependency file.
- Page object "selectors" must come from the page analysis or the repository analysis's verified selectors only, otherwise leave empty and note defensive checks.

JSON format:
{"approach":"2-3 sentences on the design and why",
 "files":[{"path":"folder/ or empty","name":"file.ext","kind":"page|test|config|deps|doc","purpose":""}],
 "pageObjects":[{"name":"","file":"","responsibilities":"","methods":[""],"selectors":[""]}],
 "fixtures":["shared setup, e.g. base_url, browser/headed env handling"],
 "scenarioMap":[{"scenarioId":"TC-01","testFile":"","testName":"","pageObjects":[""]}]}`;

  return runAgent({
    name: "architect",
    system: SYSTEM,
    prompt,
    generate,
    provider,
    apiKey,
    onEvent,
    validate: (o) => validateArchitecture(o, testPlan),
  });
}
