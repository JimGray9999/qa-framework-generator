// Single source of truth for what the pipeline will accept.
// FRAMEWORKS mirrors the UI's language/framework matrix so we can recognize a request,
// but getLanguagePrompt() only has Playwright templates. Anything outside SUPPORTED is
// rejected until matching templates exist (otherwise e.g. Python + Selenium would be
// told to generate pytest-playwright).
export const FRAMEWORKS = {
  python: ["playwright", "selenium", "pytest-bdd"],
  java: ["playwright", "testng", "junit", "cucumber"],
  javascript: ["playwright", "cypress", "webdriverio"],
  typescript: ["playwright", "cypress", "webdriverio"],
  "c#": ["playwright", "selenium", "cypress"],
};

export const SUPPORTED = new Set(["playwright"]);

// Canonical display value used by the rest of the app ("C#" is mixed case there).
export const displayLanguage = (l) => (l === "c#" ? "C#" : l);

// True for github.com/<owner>/<repo>[/...] links. Other github.com pages (login, features,
// pricing, ...) are not repositories and stay valid targets.
const GITHUB_RESERVED = new Set(["login", "join", "features", "pricing", "about", "explore", "marketplace", "topics", "collections", "trending",
  "sponsors", "settings", "notifications", "orgs", "organizations", "apps", "enterprise", "customer-stories", "readme", "security", "pulls",
  "issues", "codespaces", "search", "new", "sessions", "site", "contact", "events", "team", "solutions", "resources", "copilot", "github-copilot",
  "account", "dashboard", "signup", "logout", "password_reset", "mobile", "stars", "watching", "gist", "gists", "partners", "nonprofit", "premium-support"]);
export function looksLikeRepoUrl(url) {
  if (!/^(www\.)?github\.com$/i.test(url.hostname)) return false;
  const parts = url.pathname.split("/").filter(Boolean);
  return parts.length >= 2 && !GITHUB_RESERVED.has(parts[0].toLowerCase());
}

// The canonical URL is embedded in prompts and, through them, inside string literals of
// generated code in several languages ('...' in JS/TS, "..." in Python/Java/C#, `...` templates).
// URL.toString() keeps characters that break out of those literals (an apostrophe is valid in
// a path segment, `$` and `|` are left alone), so they are percent-encoded. The encoded form
// addresses the same resource on any normal server.
export function literalSafeUrl(urlString) {
  return urlString.replace(/['"`\\$|^{}<>]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}

// Parse a user-supplied URL for the app under test. Always returns the canonical string form
// (so quotes, newlines and other tricks cannot ride into prompts or generated code), or "" when
// empty is allowed.
export function parseTargetUrl(value, { allowEmpty = false, rejectRepoLinks = false } = {}) {
  const rawUrl = String(value ?? "").trim();
  if (!rawUrl) {
    if (allowEmpty) return "";
    throw agentError("A valid target URL is required.");
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw agentError("A valid target URL is required.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw agentError("Target URL must be http or https.");
  if (url.username || url.password) throw agentError("The target URL must not contain a username or password.");
  if (rejectRepoLinks && looksLikeRepoUrl(url)) {
    throw agentError('That is a GitHub repository URL, not the running app. Use "Attach code" for the repository and give the URL where the app runs.');
  }
  return literalSafeUrl(url.toString());
}

// Validation for the manual /api/generate path: language and framework must be known values
// before they are placed into a prompt, and the URL must be a real http(s) URL. Unlike the
// agent pipeline it accepts every framework in the matrix (its prompts are unchanged).
export function normalizeGenerateInput(raw) {
  const language = String(raw?.language ?? "").toLowerCase().replace("csharp", "c#").trim();
  const framework = String(raw?.framework ?? "").toLowerCase().trim();
  if (!FRAMEWORKS[language]) throw agentError(`Unsupported language "${printableValue(raw?.language)}".`);
  if (!FRAMEWORKS[language].includes(framework)) {
    throw agentError(`"${printableValue(framework)}" is not available for ${language}. Options: ${FRAMEWORKS[language].join(", ")}.`);
  }
  return { language: displayLanguage(language), framework, targetUrl: parseTargetUrl(raw?.targetUrl) };
}

const printableValue = (v) => String(v ?? "").replace(/[^\x20-\x7e]/g, "?").slice(0, 40);

export function normalizeRequest(raw, { hasRepo = false } = {}) {
  const language = String(raw?.language || "").toLowerCase().replace("csharp", "c#").trim();
  const framework = String(raw?.framework || "").toLowerCase().trim();
  if (!FRAMEWORKS[language]) throw agentError(`Unsupported language "${raw?.language}".`);
  if (!FRAMEWORKS[language].includes(framework)) {
    throw agentError(`"${framework}" is not available for ${language}. Options: ${FRAMEWORKS[language].join(", ")}.`);
  }
  if (!SUPPORTED.has(framework)) {
    throw agentError(`${framework} is not supported by the agent pipeline yet. Only ${[...SUPPORTED].join(", ")} is currently implemented.`);
  }
  // The URL of the running app. Optional when a repository is attached (the pipeline then
  // falls back to the base URL found in the code, or http://localhost:3000).
  const targetUrl = parseTargetUrl(raw?.targetUrl, { allowEmpty: hasRepo, rejectRepoLinks: true });
  const focus = Array.isArray(raw?.focus) ? raw.focus.map(String).slice(0, 8).map((f) => f.slice(0, 200)) : [];
  // Where the URL came from: the user, the repository analysis, or the localhost default.
  const targetUrlSource = ["user", "repo", "default"].includes(raw?.targetUrlSource) ? raw.targetUrlSource : targetUrl ? "user" : "";
  return { language: displayLanguage(language), framework, targetUrl, targetUrlSource, focus };
}

// Errors safe to surface to the client verbatim.
export function agentError(message) {
  const err = new Error(message);
  err.expose = true;
  return err;
}
