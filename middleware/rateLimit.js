// Minimal in-memory fixed-window rate limiter (no dependencies).
// Keyed by client IP. State lives in process memory, which is fine for this
// single-process, localhost-bound server; swap for express-rate-limit + a shared
// store if it is ever deployed behind multiple instances.
export function rateLimit({ windowMs = 60_000, max = 15, message = "Too many requests. Please slow down." } = {}) {
  const hits = new Map(); // key -> { count, resetAt }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  sweep.unref(); // never keep the process alive for cleanup

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(remaining));
    res.set("RateLimit-Reset", String(Math.ceil((entry.resetAt - now) / 1000)));

    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
