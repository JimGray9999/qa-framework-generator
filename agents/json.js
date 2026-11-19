// Extract and parse a JSON object from a model response (handles code fences,
// surrounding prose, and trailing commas).
export function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch { /* fall through */ }
  }
  const raw = text.match(/\{[\s\S]*\}/);
  if (!raw) throw new Error("No JSON object found in response");
  try {
    return JSON.parse(raw[0]);
  } catch {
    return JSON.parse(raw[0].replace(/,(\s*[}\]])/g, "$1"));
  }
}
