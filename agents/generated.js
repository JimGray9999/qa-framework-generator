import { sanitizeEntryPath } from "../repo/zipReader.js";

// Validation of model-generated framework files, shared by /api/generate and the Engineer
// agent. The output of a model that has read untrusted text (a live page, repository source)
// is itself untrusted: it must not be able to name files outside the project, smuggle
// control characters into paths, or be arbitrarily large. Content is validated for type and
// size only (empty files such as __init__.py are legitimate); the run-time static scan
// (scanGeneratedFiles) still inspects it before anything executes.

export const GENERATED_LIMITS = { maxFiles: 60, maxName: 160, maxPath: 300, maxFileChars: 500_000, maxTotalChars: 2_000_000 };

const CONTROL = /[\u0000-\u001f\u007f]/;
const printable = (s, n = 60) => String(s).replace(/[^\x20-\x7e]/g, "?").slice(0, n);

// Returns normalised copies ({name, path, content}); throws a plain Error naming the problem
// (the Engineer feeds it back to the model for a retry; /api/generate maps it to a message).
export function validateGeneratedFiles(files, limits = GENERATED_LIMITS) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("files must be a non-empty list");
  if (files.length > limits.maxFiles) throw new Error(`too many files (${files.length}; the limit is ${limits.maxFiles})`);
  const seen = new Set();
  let total = 0;
  return files.map((f, i) => {
    const at = `file #${i + 1}`;
    if (!f || typeof f !== "object") throw new Error(`${at} is not an object`);
    const name = typeof f.name === "string" ? f.name.trim() : "";
    const path = f.path == null ? "" : f.path;
    if (!name) throw new Error(`${at} has no "name"`);
    if (typeof path !== "string") throw new Error(`${at} has a non-string "path"`);
    if (name.length > limits.maxName || path.length > limits.maxPath) throw new Error(`${at} has a name or path that is too long`);
    if (CONTROL.test(name) || CONTROL.test(path) || name.includes("\\") || path.includes("\\")) {
      throw new Error(`${at} ("${printable(name)}") has control characters or backslashes in its name or path`);
    }
    // The location the file would be written to must stay inside the project directory.
    const full = `${path}${path && !path.endsWith("/") ? "/" : ""}${name}`;
    if (!sanitizeEntryPath(full)) throw new Error(`${at} ("${printable(full)}") has an absolute path or a ".." segment`);
    if (typeof f.content !== "string") throw new Error(`${at} ("${printable(name)}") has no string "content"`);
    if (f.content.length > limits.maxFileChars) throw new Error(`${at} ("${printable(name)}") is larger than ${limits.maxFileChars} characters`);
    total += f.content.length;
    if (total > limits.maxTotalChars) throw new Error(`the generated files exceed ${limits.maxTotalChars} characters in total`);
    const key = sanitizeEntryPath(full).toLowerCase();
    if (seen.has(key)) throw new Error(`${at} ("${printable(full)}") duplicates an earlier file`);
    seen.add(key);
    return { name, path: path || "", content: f.content };
  });
}
