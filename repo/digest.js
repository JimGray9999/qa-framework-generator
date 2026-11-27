import { openZip, ZipError } from "./zipReader.js";

// Turn an (untrusted) repository archive into a bounded, secret-free digest for the Repo
// Analyst agent. The digest has two halves:
//   * deterministic facts extracted by code (stack, scripts, routes, UI selectors), which
//     the agent can cite but cannot invent; and
//   * a budgeted sample of the most informative source files.
// Everything here is read from memory; nothing from the archive is written to disk.

export const DIGEST_LIMITS = {
  maxFileBytes: 200_000,       // never inflate a single file larger than this
  maxTotalReadBytes: 12_000_000, // across all files read for analysis
  maxCandidates: 400,          // files read for scoring
  charBudget: 60_000,          // characters of file content sent to the model
  perFileChars: 6_000,
  maxTreeLines: 300,
  maxSelectors: 200,
  maxRoutes: 80,
};

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", "target", "bin", "obj", "vendor",
  "__pycache__", ".venv", "venv", "env", "coverage", ".idea", ".vscode", ".gradle", ".pytest_cache", ".mypy_cache", "bower_components", ".svn", ".hg"]);
const TEXT_EXT = new Set(["js", "jsx", "ts", "tsx", "mjs", "cjs", "vue", "svelte", "html", "htm", "py", "java", "cs", "cshtml", "razor", "go",
  "rb", "php", "json", "md", "txt", "yml", "yaml", "toml", "xml", "csproj", "gradle", "properties", "kt", "ejs", "hbs", "jinja", "j2", "erb"]);
const SKIP_FILE_RE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|composer\.lock|Gemfile\.lock|.*\.min\.(js|css)|.*\.map)$/i;
// Files that commonly hold credentials: never read, never sent to a model provider.
const SECRET_FILE_RE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|jks|keystore|crt|cer)|id_(rsa|dsa|ecdsa|ed25519).*|credentials?(\..*)?|secrets?(\..*)?|\.npmrc|\.pypirc|\.htpasswd|\.netrc|service[-_]?account.*\.json|.*\.tfvars|terraform\.tfstate.*)$/i;

const ext = (p) => (p.includes(".") ? p.slice(p.lastIndexOf(".") + 1).toLowerCase() : "");

// ---- redaction (applied to everything that goes into a prompt) ----------------------
const REDACTIONS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
];
const KEYED_SECRET = /((?:api[_-]?key|secret|token|passw(?:or)?d|pwd|private[_-]?key|authorization|client[_-]?secret|connection[_-]?string)["']?\s*[:=]\s*)(["'`])[^"'`\n]{6,}\2/gi;

export function redact(text) {
  let count = 0;
  let out = text;
  for (const re of REDACTIONS) out = out.replace(re, () => { count++; return "[REDACTED]"; });
  out = out.replace(KEYED_SECRET, (_m, key, q) => { count++; return `${key}${q}[REDACTED]${q}`; });
  return { text: out, count };
}

// ---- deterministic extraction ----------------------------------------------------------
const SELECTOR_PATTERNS = [
  { kind: "data-testid", re: /\bdata-test(?:id|-id)?\s*=\s*["']([^"'{}$]{1,80})["']/g, css: (v, m) => `[${m[0].match(/data-test(?:id|-id)?/)[0]}="${v}"]` },
  { kind: "data-cy", re: /\bdata-cy\s*=\s*["']([^"'{}$]{1,80})["']/g, css: (v) => `[data-cy="${v}"]` },
  { kind: "id", re: /<(?:input|button|select|textarea|form|a|div|span|nav|section|h[1-6]|label|table|ul)\b[^>]*?\bid\s*=\s*["']([A-Za-z][\w:-]{0,60})["']/g, css: (v) => `#${v}` },
  { kind: "name", re: /<(?:input|select|textarea)\b[^>]*?\bname\s*=\s*["']([^"'{}$]{1,60})["']/g, css: (v) => `[name="${v}"]` },
  { kind: "aria-label", re: /\baria-label\s*=\s*["']([^"'{}$]{1,80})["']/g, css: (v) => `[aria-label="${v}"]` },
  { kind: "placeholder", re: /\bplaceholder\s*=\s*["']([^"'{}$]{1,80})["']/g, css: (v) => `[placeholder="${v}"]` },
];
const ROUTE_PATTERNS = [
  /\b(?:app|router|server)\.(get|post|put|delete|patch|all)\(\s*['"`](\/[^'"`]*)['"`]/g,
  /@(?:\w+)\.(route|get|post|put|delete|patch)\(\s*['"](\/[^'"]*)['"]/g,
  /<Route[^>]*\bpath\s*=\s*["'](\/[^"']*)["']/g,
  /\bpath\(\s*['"]([^'"]*)['"]/g,
  /@(?:Get|Post|Put|Delete|Patch|Request)Mapping\(\s*(?:value\s*=\s*)?["'](\/[^"']*)["']/g,
  /\[(?:Http(?:Get|Post|Put|Delete)|Route)\(\s*"([^"]+)"\s*\)\]/g,
];

function addUnique(list, item, key, max) {
  if (list.length < max && !list.some((x) => x[key] === item[key])) list.push(item);
}

function extractFacts(path, text, facts) {
  for (const { kind, re, css } of SELECTOR_PATTERNS) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text)); ) addUnique(facts.selectors, { selector: css(m[1], m), kind, file: path }, "selector", DIGEST_LIMITS.maxSelectors);
  }
  for (const re of ROUTE_PATTERNS) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text)); ) {
      const route = m[m.length - 1];
      const method = m.length > 2 ? String(m[1]).toUpperCase() : "";
      addUnique(facts.routes, { route: route.slice(0, 120), method, file: path }, "route", DIGEST_LIMITS.maxRoutes);
    }
  }
  // file-system routing: pages/foo.jsx, app/foo/page.tsx
  const next = path.match(/(?:^|\/)(?:src\/)?(?:pages\/(.+)|app\/(.+)\/page)\.(?:jsx?|tsx?|vue|svelte)$/);
  if (next) {
    const r = "/" + (next[1] || next[2]).replace(/\/index$/, "").replace(/^index$/, "");
    addUnique(facts.routes, { route: r === "/" ? "/" : r.replace(/\/$/, ""), method: "", file: path }, "route", DIGEST_LIMITS.maxRoutes);
  }
}

const STACK_HINTS = [
  ["react", "React"], ["vue", "Vue"], ["@angular/core", "Angular"], ["next", "Next.js"], ["nuxt", "Nuxt"], ["svelte", "Svelte"],
  ["express", "Express"], ["fastify", "Fastify"], ["koa", "Koa"], ["@nestjs/core", "NestJS"], ["vite", "Vite"], ["webpack", "webpack"],
  ["flask", "Flask"], ["django", "Django"], ["fastapi", "FastAPI"], ["spring-boot", "Spring Boot"], ["laravel/framework", "Laravel"], ["rails", "Rails"],
];

function detectStack(path, text, facts) {
  const base = path.split("/").pop().toLowerCase();
  if (base === "package.json") {
    facts.stack.add("Node.js");
    try {
      const pkg = JSON.parse(text);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [needle, label] of STACK_HINTS) if (deps[needle]) facts.stack.add(label);
      if (deps.typescript) facts.stack.add("TypeScript");
      if (pkg.scripts && typeof pkg.scripts === "object" && path.split("/").length <= 3) {
        for (const k of ["start", "dev", "serve", "build", "test"]) if (typeof pkg.scripts[k] === "string") facts.scripts.push({ file: path, name: k, command: pkg.scripts[k].slice(0, 160) });
      }
    } catch { /* malformed manifest: ignore */ }
  } else if (base === "requirements.txt" || base === "pyproject.toml" || base === "pipfile") {
    facts.stack.add("Python");
    const lower = text.toLowerCase();
    for (const [needle, label] of STACK_HINTS) if (["flask", "django", "fastapi"].includes(needle) && lower.includes(needle)) facts.stack.add(label);
  } else if (base === "pom.xml" || base === "build.gradle" || base === "build.gradle.kts") {
    facts.stack.add("Java");
    if (/spring-boot/i.test(text)) facts.stack.add("Spring Boot");
  } else if (base.endsWith(".csproj")) {
    facts.stack.add(".NET");
    if (/Microsoft\.NET\.Sdk\.Web|AspNetCore/i.test(text)) facts.stack.add("ASP.NET Core");
  } else if (base === "go.mod") facts.stack.add("Go");
  else if (base === "composer.json") facts.stack.add("PHP");
  else if (base === "gemfile") facts.stack.add("Ruby");
  else if (base === "dockerfile" || /^docker-compose\.ya?ml$/.test(base)) facts.stack.add("Docker");
}

function pathScore(path) {
  const base = path.split("/").pop().toLowerCase();
  const depth = path.split("/").length;
  let s = 0;
  if (/^readme(\.\w+)?$/.test(base)) s += 100;
  else if (["package.json", "requirements.txt", "pyproject.toml", "pom.xml", "go.mod", "composer.json", "gemfile", "build.gradle"].includes(base) || base.endsWith(".csproj")) s += 90;
  else if (/^(dockerfile|docker-compose\.ya?ml)$/.test(base)) s += 60;
  if (/(^|\/)(routes?|pages?|views?|controllers?|templates?|screens?|components?|app)\//i.test(path)) s += 40;
  if (/(^|\/)(index|main|app|server|login|checkout|cart|home|register|signup)\.\w+$/i.test(path)) s += 25;
  if (/\.(test|spec)\.|(^|\/)(tests?|__tests__|e2e|cypress)\//i.test(path)) s -= 30; // existing tests are less informative than the app
  if (/\.(html|jsx|tsx|vue|svelte|cshtml|razor|ejs|hbs|jinja|j2|erb)$/.test(path)) s += 20;
  return s - depth;
}

export function buildDigest(buffer, { name = "repository", limits = DIGEST_LIMITS } = {}) {
  const zip = openZip(buffer);

  // GitHub wraps everything in "<owner>-<repo>-<sha>/": strip a single shared top-level folder.
  let files = zip.entries;
  const tops = new Set(files.map((e) => e.path.split("/")[0]));
  const strip = tops.size === 1 && files.every((e) => e.path.includes("/"));
  files = files.map((e) => ({ ...e, rel: strip ? e.path.slice(e.path.indexOf("/") + 1) : e.path }));

  const stats = { totalFiles: files.length, ignored: 0, secretFilesSkipped: 0, notText: 0, tooLarge: 0, redactions: 0, unreadable: 0,
    zipSkipped: zip.skipped };
  const usable = [];
  for (const f of files) {
    const segs = f.rel.split("/");
    if (segs.some((s) => IGNORED_DIRS.has(s)) || SKIP_FILE_RE.test(f.rel)) { stats.ignored++; continue; }
    if (SECRET_FILE_RE.test(f.rel)) { stats.secretFilesSkipped++; continue; }
    if (!TEXT_EXT.has(ext(f.rel)) && !/(^|\/)(dockerfile|gemfile|pipfile)$/i.test(f.rel)) { stats.notText++; continue; }
    if (f.size > limits.maxFileBytes) { stats.tooLarge++; continue; }
    usable.push(f);
  }

  usable.sort((a, b) => pathScore(b.rel) - pathScore(a.rel) || a.rel.localeCompare(b.rel));
  const facts = { stack: new Set(), scripts: [], routes: [], selectors: [] };
  const candidates = [];
  let readBytes = 0;
  for (const f of usable.slice(0, limits.maxCandidates)) {
    if (readBytes + f.size > limits.maxTotalReadBytes) break;
    let text;
    try { text = zip.read(f, { maxBytes: limits.maxFileBytes }).toString("utf8"); } catch (e) { if (e instanceof ZipError) { stats.unreadable++; continue; } throw e; }
    readBytes += f.size;
    if (text.includes("\0")) { stats.notText++; continue; } // binary content with a text extension
    extractFacts(f.rel, text, facts);
    detectStack(f.rel, text, facts);
    const bonus = (/<form|<input|<button|data-testid|@app\.route|\.get\(|router\./.test(text) ? 30 : 0) - Math.min(20, Math.floor(text.length / 2000));
    candidates.push({ path: f.rel, text, score: pathScore(f.rel) + bonus });
  }

  // Budgeted sample of file contents, redacted.
  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const sample = [];
  let chars = 0;
  for (const c of candidates) {
    if (chars >= limits.charBudget) break;
    const { text, count } = redact(c.text.slice(0, limits.perFileChars));
    stats.redactions += count;
    const clipped = c.text.length > limits.perFileChars;
    sample.push({ path: c.path, content: text, clipped });
    chars += text.length;
  }

  const tree = usable.map((f) => f.rel).sort().slice(0, limits.maxTreeLines);
  return {
    name,
    stack: [...facts.stack],
    scripts: facts.scripts.slice(0, 12),
    routes: facts.routes,
    selectors: facts.selectors,
    tree,
    treeTruncated: usable.length > tree.length,
    sample,
    stats,
  };
}

// Render the digest as prompt text. Repository content is wrapped in explicit markers so the
// model can tell data from instructions (the analyst prompt tells it to treat it as data).
export function digestToPrompt(d) {
  const lines = [];
  lines.push(`REPOSITORY: ${d.name}`);
  lines.push(`FILES ANALYSED: ${d.stats.totalFiles - d.stats.ignored - d.stats.secretFilesSkipped - d.stats.notText - d.stats.tooLarge} of ${d.stats.totalFiles} (ignored: ${d.stats.ignored}, secret-bearing files skipped: ${d.stats.secretFilesSkipped}, non-text: ${d.stats.notText}, too large: ${d.stats.tooLarge})`);
  lines.push(`DETECTED STACK: ${d.stack.join(", ") || "unknown"}`);
  if (d.scripts.length) lines.push("SCRIPTS:\n" + d.scripts.map((s) => `- ${s.file}: ${s.name} = ${s.command}`).join("\n"));
  if (d.routes.length) lines.push("DETECTED ROUTES (heuristic):\n" + d.routes.map((r) => `- ${r.method ? r.method + " " : ""}${r.route}  (${r.file})`).join("\n"));
  if (d.selectors.length) lines.push("DETECTED UI ELEMENTS (extracted from source; use these exact selector strings):\n" + d.selectors.map((s) => `- ${s.selector}  [${s.kind}, ${s.file}]`).join("\n"));
  lines.push(`FILE TREE${d.treeTruncated ? " (truncated)" : ""}:\n` + d.tree.join("\n"));
  for (const f of d.sample) lines.push(`<<<FILE ${f.path}${f.clipped ? " (clipped)" : ""}>>>\n${f.content}\n<<<END FILE>>>`);
  return lines.join("\n\n");
}
