import "server-only";
import { after } from "next/server";
import { env } from "@/lib/env";
import { clientEnv } from "@/lib/env.client";

/**
 * APX-20: start a drain right after work is enqueued, instead of waiting for
 * the next GitHub Actions tick.
 *
 * `jobs-drain.yml` is scheduled every 5 minutes, but GitHub's scheduler is
 * best-effort and was observed running the drain only every 5–8 HOURS. A bill
 * PDF or a photo thumbnail sat `pending` all that time. So `enqueue()` now
 * also calls `/api/cron/jobs.drain` itself, with the same Bearer CRON_SECRET
 * the workflow sends. The schedule stays as the fallback: anything this kick
 * misses (it failed, the function was frozen, the drain hit its deadline) is
 * still picked up by the next tick, exactly as before.
 *
 * Fire-and-forget, and it cannot fail or slow the user's action:
 *   - it runs inside `after()`, i.e. once the response has been sent;
 *   - every error is caught and logged, never rethrown;
 *   - the request is bounded by KICK_TIMEOUT_MS;
 *   - a second kick while one drain is running is harmless —
 *     rpc_claim_jobs' FOR UPDATE SKIP LOCKED gives each disjoint work.
 *
 * Production only, so a developer's `pnpm dev` (which talks to the one
 * production database, D49) does not start draining the live queue on its
 * own. The drain runs as its own function invocation — its own 60-second
 * budget — not inside the request that enqueued.
 */
export const KICK_TIMEOUT_MS = 25_000;

/** The drain route on this deployment's public origin, or null when there is
 *  nothing safe to call. */
export function drainUrl(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  const base = clientEnv.NEXT_PUBLIC_SITE_URL;
  if (!base) return null;
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    return null;
  }
  if (origin.hostname === "localhost" || origin.hostname === "127.0.0.1") return null;
  return new URL("/api/cron/jobs.drain", origin).toString();
}

/** The call itself. Exported for tests; never throws. */
export async function callDrain(fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = drainUrl();
  if (!url) return;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      cache: "no-store",
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[jobs] drain kick: ${url} returned HTTP ${res.status}`);
  } catch (e) {
    // A timeout is expected for a long drain and harmless: the drain carries
    // on in its own invocation, and the schedule is the safety net either way.
    console.error("[jobs] drain kick failed (the scheduled drain will pick the work up)", e);
  }
}

/** Schedule a drain for after the current response. Never throws. */
export function kickDrain(): void {
  try {
    after(() => callDrain());
  } catch (e) {
    // after() outside a request scope (a script, a test) — nothing to kick.
    console.error("[jobs] drain kick not scheduled", e);
  }
}
