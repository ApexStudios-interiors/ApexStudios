import { createHash, timingSafeEqual } from "node:crypto";

/**
 * `Authorization: Bearer <secret>` checked in constant time (APX-57). The cron
 * and backup-report routes compared with `!==`, which returns as soon as one
 * byte differs and so leaks, through timing, how much of a guess was right.
 *
 * Both sides are hashed first so the comparison is always of two equal-length
 * buffers — timingSafeEqual throws on a length mismatch, and branching on the
 * length would leak the secret's length instead. An empty or missing secret
 * never authorises anything.
 */
export function bearerMatches(header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const actual = createHash("sha256").update(header).digest();
  return timingSafeEqual(actual, expected);
}
