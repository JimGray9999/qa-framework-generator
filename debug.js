// Debug logging gate (audit M6). Startup and request-content logs are silent unless DEBUG enables
// them: DEBUG=qafg:* (or qafg, or *). Read per call so tests can toggle it.
export function debugEnabled(env = process.env) {
  return String(env.DEBUG || '').split(/[\s,]+/).some((p) => p === '*' || p === 'qafg' || p === 'qafg:*');
}
export function debugLog(...args) {
  if (debugEnabled()) console.log(...args);
}
