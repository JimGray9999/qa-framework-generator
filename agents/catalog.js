// Single source of truth for what the pipeline will accept. Mirrors the UI's
// language/framework matrix. Only Playwright is validated end to end.
export const FRAMEWORKS = {
  python: ["playwright", "selenium", "pytest-bdd"],
  java: ["playwright", "testng", "junit", "cucumber"],
  javascript: ["playwright", "cypress", "webdriverio"],
  typescript: ["playwright", "cypress", "webdriverio"],
  "c#": ["playwright", "selenium", "cypress"],
};

export const VALIDATED = new Set(["playwright"]);

// Canonical display value used by the rest of the app ("C#" is mixed case there).
export const displayLanguage = (l) => (l === "c#" ? "C#" : l);

export function normalizeRequest(raw) {
  const language = String(raw?.language || "").toLowerCase().replace("csharp", "c#").trim();
  const framework = String(raw?.framework || "").toLowerCase().trim();
  if (!FRAMEWORKS[language]) throw agentError(`Unsupported language "${raw?.language}".`);
  if (!FRAMEWORKS[language].includes(framework)) {
    throw agentError(`"${framework}" is not available for ${language}. Options: ${FRAMEWORKS[language].join(", ")}.`);
  }
  let url;
  try {
    url = new URL(String(raw?.targetUrl || ""));
  } catch {
    throw agentError("A valid target URL is required.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw agentError("Target URL must be http or https.");
  const focus = Array.isArray(raw?.focus) ? raw.focus.map(String).slice(0, 8).map((f) => f.slice(0, 200)) : [];
  return { language: displayLanguage(language), framework, targetUrl: url.toString(), focus };
}

// Errors safe to surface to the client verbatim.
export function agentError(message) {
  const err = new Error(message);
  err.expose = true;
  return err;
}
