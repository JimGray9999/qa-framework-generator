// Caps how many pieces of long-running work execute at once (e.g. test runs, which
// can each last minutes). Unlike a per-minute rate limit this bounds actual load.
// tryAcquire() returns a release function, or null when the gate is full. The
// release function is idempotent, so a double release can never free someone else's slot.
export function createConcurrencyGate(max) {
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError(`concurrency gate: max must be a positive integer, got ${max}`);
  }
  let active = 0;
  return {
    max,
    get active() { return active; },
    tryAcquire() {
      if (active >= max) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}
