/**
 * A probe whose answer is reused for `ttlMs` (APX-57). /api/health is public
 * and unauthenticated; run fresh on every hit, it let anyone open a database
 * connection and an R2 request per request. Cached, a flood of hits costs one
 * real check per window, and concurrent callers within a check share it
 * rather than each starting their own.
 *
 * Pure (no framework imports), so the timing is unit-tested with a fake clock.
 */
export function cachedProbe<T>(run: () => Promise<T>, ttlMs: number, now: () => number = Date.now) {
  let last: { at: number; value: T } | null = null;
  let inFlight: Promise<T> | null = null;

  return async function probe(): Promise<T> {
    if (last && now() - last.at < ttlMs) return last.value;
    if (inFlight) return inFlight;
    inFlight = run()
      .then((value) => {
        last = { at: now(), value };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
