// Model-generated framework files: ONE place that decides where a file goes and whether it
// is acceptable. Used by /api/generate, the Engineer agent, /api/run-tests (staging) and
// /api/download-zip (export), so validation, staging and export can never disagree about a
// file's destination (previously the runner and the zip export resolved `path` + `name`
// differently, and a duplicate check on a third formula could be bypassed).
//
// The output of a model that has read untrusted text (a live page, repository source) is
// itself untrusted: it must not name files outside the project, smuggle control characters
// into paths, break on Windows (reserved device names, ':' alternate data streams, trailing
// dots), collide with itself, or be arbitrarily large. Content is validated for type and size
// only (empty files such as __init__.py are legitimate); the run-time static scan
// (scanGeneratedFiles) still inspects it before anything executes.

export const GENERATED_LIMITS = { maxFiles: 60, maxName: 160, maxPath: 300, maxFileChars: 500_000, maxTotalChars: 2_000_000, maxFullPath: 200 };

const printable = (s, n = 60) => String(s).replace(/[^\x20-\x7e]/g, "?").slice(0, n);
const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001f\u007f]/;
// Windows file-name rules (https://learn.microsoft.com/windows/win32/fileio/naming-a-file) applied
// everywhere: a framework generated on Linux must also unpack and run on Windows.
const WIN_BAD_CHARS = /[<>:"|?*]/;
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function segmentProblem(seg) {
  if (WIN_BAD_CHARS.test(seg)) return 'contains a character that is not allowed in file names (< > : " | ? *)';
  if (/[. ]$/.test(seg)) return "ends with a dot or a space";
  if (WIN_RESERVED.test(seg)) return "is a reserved device name";
  if (seg.length > 255) return "is too long";
  return null;
}

// Where does this file go? Returns { dir, base, full } or { error }.
// `name` may carry its own directory part ("tests/a.py"). If that directory repeats or extends
// `path` ("tests/" + "tests/a.py", or "tests/" + "tests/sub/a.py") it wins; otherwise it is
// appended to `path`. Matching is by whole path segments, not by string prefix.
export function resolveGeneratedPath(file) {
  const rawPath = file?.path == null ? "" : file.path;
  const rawName = file?.name;
  if (typeof rawName !== "string" || typeof rawPath !== "string") return { error: "name and path must be strings" };
  if (CONTROL_OR_BACKSLASH.test(rawName) || CONTROL_OR_BACKSLASH.test(rawPath)) return { error: "has control characters or backslashes in its name or path" };
  if (/^(\/|[A-Za-z]:)/.test(rawName.trim()) || /^(\/|[A-Za-z]:)/.test(rawPath.trim())) return { error: "has an absolute path" };

  const dirParts = rawPath.split("/").filter((s) => s && s !== ".");
  const nameParts = rawName.trim().split("/").filter((s) => s && s !== ".");
  if (!nameParts.length || rawName.trim().endsWith("/")) return { error: 'has no file "name"' };
  const base = nameParts.pop();
  let dir = dirParts;
  if (nameParts.length) {
    const repeatsPath = dirParts.length > 0 && nameParts.length >= dirParts.length && dirParts.every((s, i) => s === nameParts[i]);
    dir = dirParts.length === 0 || repeatsPath ? nameParts : [...dirParts, ...nameParts];
  }
  for (const seg of [...dir, base]) {
    if (seg === "..") return { error: 'has a ".." segment in its path' };
    const problem = segmentProblem(seg);
    if (problem) return { error: `has a path segment ("${printable(seg, 30)}") that ${problem}` };
  }
  return { dir: dir.join("/"), base, full: [...dir, base].join("/") };
}

// Returns canonical copies: { name: <file name only>, path: <"" or "dir/sub/">, content }.
// Throws a plain Error naming the problem (the Engineer feeds it back to the model for a retry;
// the HTTP routes map it to a message).
export function validateGeneratedFiles(files, limits = GENERATED_LIMITS) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("files must be a non-empty list");
  if (files.length > limits.maxFiles) throw new Error(`too many files (${files.length}; the limit is ${limits.maxFiles})`);
  const seen = new Set();
  let total = 0;
  return files.map((f, i) => {
    const at = `file #${i + 1}`;
    if (!f || typeof f !== "object") throw new Error(`${at} is not an object`);
    if (typeof f.name === "string" && f.name.length > limits.maxName) throw new Error(`${at} has a name or path that is too long`);
    if (typeof f.path === "string" && f.path.length > limits.maxPath) throw new Error(`${at} has a name or path that is too long`);
    const r = resolveGeneratedPath(f);
    if (r.error) throw new Error(`${at} ("${printable(f.name)}") ${r.error}`);
    if (r.full.length > limits.maxFullPath) throw new Error(`${at} ("${printable(r.full)}") has a path that is too long`);
    if (typeof f.content !== "string") throw new Error(`${at} ("${printable(r.full)}") has no string "content"`);
    if (f.content.length > limits.maxFileChars) throw new Error(`${at} ("${printable(r.full)}") is larger than ${limits.maxFileChars} characters`);
    total += f.content.length;
    if (total > limits.maxTotalChars) throw new Error(`the generated files exceed ${limits.maxTotalChars} characters in total`);
    // Case-insensitive: Windows and macOS file systems would overwrite one with the other.
    const key = r.full.toLowerCase();
    if (seen.has(key)) throw new Error(`${at} ("${printable(r.full)}") duplicates an earlier file`);
    seen.add(key);
    return { name: r.base, path: r.dir ? `${r.dir}/` : "", content: f.content };
  });
}
