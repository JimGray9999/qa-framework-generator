// Largest delay Node timers support (2^31 - 1 ms, ~24.8 days). Larger values make
// setTimeout/setInterval fire almost immediately.
export const MAX_TIMER_MS = 2147483647;

// Read a positive-integer setting from the environment. Anything else (non-numeric,
// zero, negative, fractional, out of range) logs a warning and falls back to the
// documented default, so a typo can never silently disable a protection.
export function envInt(name, fallback, { max = Number.MAX_SAFE_INTEGER, env = process.env } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const text = String(raw).trim();
  const n = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(n) || n < 1 || n > max) {
    console.warn(`[config] ${name}="${raw}" is invalid (need an integer from 1 to ${max}); using the default ${fallback}`);
    return fallback;
  }
  return n;
}
