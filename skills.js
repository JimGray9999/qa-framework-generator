import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "skills");

// Languages migrated to skills so far. Others fall back to getLanguagePrompt().
const LANGUAGE_SKILLS = { python: "qa-playwright-python" };

export function skillNameFor(language) {
  return LANGUAGE_SKILLS[(language || "python").toLowerCase()] || null;
}

function readSkill(name) {
  const file = join(SKILLS_DIR, name, "SKILL.md");
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8");
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  const sections = {};
  let current = null;
  for (const line of body.split("\n")) {
    const m = line.match(/^## (.+)$/);
    if (m) { current = m[1].trim().toLowerCase(); sections[current] = []; }
    else if (current) sections[current].push(line);
  }
  for (const k of Object.keys(sections)) sections[k] = sections[k].join("\n").trim();
  return sections;
}

// Returns { fileList, rules } in the same shape as getLanguagePrompt(), or null
// if the language has no skill (or its SKILL.md is missing/incomplete).
export function loadLanguageSkill(language, targetUrl) {
  const name = skillNameFor(language);
  if (!name) return null;
  const lang = readSkill(name);
  if (!lang?.files || !lang?.rules) return null;
  const shared = readSkill("qa-conventions");
  const fill = (s) => s.replaceAll("{{targetUrl}}", () => targetUrl);
  return {
    fileList: fill(lang.files),
    rules: fill([lang.rules, shared?.rules].filter(Boolean).join("\n")),
    skill: name
  };
}
