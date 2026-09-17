import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { JOB_REGISTRY } from "./registry";

/**
 * Claim → dispatch → finish, driven by `app/api/cron/[job]/route.ts`
 * (build §3.1–§3.2). Every call here runs as `service_role`: `rpc_claim_jobs`
 * and `rpc_finish_job` (migration 0012) are granted to it alone, and a
 * self-enqueued scheduled job writes to `jobs` directly for the same reason —
 * a cron invocation authenticates via `CRON_SECRET`, not a Supabase session,
 * so it has no RLS-scoped identity to act as in the first place. This is
 * exactly the "background jobs run as service_role by design" carve-out
 * `lib/supabase/admin.ts`'s own comment documents.
 */

export type DrainSummary = { claimed: number; succeeded: number; failed: number; durationMs: number };

type JobRow = { id: string; name: string; payload: unknown };

async function runOne(supabase: SupabaseClient, job: JobRow): Promise<boolean> {
  const handler = JOB_REGISTRY[job.name];
  try {
    if (!handler) throw new Error(`no handler registered for job "${job.name}"`);
    await handler(job.payload, job.id);
    await finish(supabase, job.id, true);
    return true;
  } catch (e) {
    // The failure record is `jobs.last_error`, written by `rpc_finish_job`
    // below and surfaced on the Admin ops page — that row is the alert
    // (docs/architecture.md §9.2), so the message must always reach it.
    const message = e instanceof Error ? e.message : String(e);
    await finish(supabase, job.id, false, message);
    return false;
  }
}

async function finish(supabase: SupabaseClient, id: string, ok: boolean, error?: string): Promise<void> {
  const { error: rpcError } = await supabase.rpc("rpc_finish_job", {
    p_id: id,
    p_ok: ok,
    p_error: error ?? null,
  });
  if (rpcError) throw new Error(rpcError.message);
}

/**
 * Claims up to `limit` due jobs matching `names` at a time, repeating until
 * the queue for those names is empty or `deadlineMs` has elapsed — the cron
 * route's own time-budget guard (build §3.2 step 5): stop claiming new work
 * before the function's own timeout, and leave the rest for the next tick
 * rather than dying mid-batch. `rpc_claim_jobs`'s `FOR UPDATE SKIP LOCKED` is
 * what makes two overlapping invocations of this safe.
 */
export async function drain(
  names: readonly string[],
  opts: { limit?: number; deadlineMs?: number } = {}
): Promise<DrainSummary> {
  const start = Date.now();
  const limit = opts.limit ?? 5;
  const deadlineMs = opts.deadlineMs ?? 8000;
  const supabase = createAdminClient();

  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  while (Date.now() - start < deadlineMs) {
    const { data, error } = await supabase.rpc("rpc_claim_jobs", {
      p_names: [...names],
      p_limit: limit,
      p_lease: "5 minutes",
    });
    if (error) throw new Error(error.message);
    const jobs = (data ?? []) as JobRow[];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      claimed++;
      const ok = await runOne(supabase, job);
      if (ok) succeeded++;
      else failed++;
    }
    if (jobs.length < limit) break; // fewer than asked for — the queue is empty
  }

  return { claimed, succeeded, failed, durationMs: Date.now() - start };
}

/**
 * The "Scheduled" flavour (01-hld.md §10.1: "cron enqueues and runs in the
 * same request"). `idempotencyKey` should encode the period the job covers
 * (a date, an ISO week) so a retried or overlapping cron tick within that
 * period is a no-op rather than a duplicate run — `jobs_idem_uq` (nulls not
 * distinct on `(name, idempotency_key)`) enforces it at the database level;
 * the unique-violation here is the expected, harmless outcome of that, not a
 * failure to surface.
 */
export async function selfEnqueueAndDrain(
  name: string,
  payload: unknown,
  idempotencyKey: string
): Promise<DrainSummary> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("jobs")
    .insert({ name, payload: payload as never, idempotency_key: idempotencyKey });
  if (error && error.code !== "23505") throw new Error(error.message);

  return drain([name], { limit: 1 });
}

/** Hourly (build §3.4): requeues jobs whose lease expired, meaning the
 *  worker died mid-run. A plain admin-client update rather than a new RPC —
 *  reaping has no business logic beyond this one WHERE clause, and the
 *  mutation needs service_role regardless of how it's issued. */
export async function reap(): Promise<{ requeued: number }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("jobs")
    .update({ status: "pending", lease_until: null, last_error: "lease expired — worker timed out" })
    .eq("status", "running")
    .lt("lease_until", new Date().toISOString())
    .select("id");
  if (error) throw new Error(error.message);
  return { requeued: data?.length ?? 0 };
}
