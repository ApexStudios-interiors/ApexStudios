import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * The one way a normal, signed-in request enqueues background work — through
 * `rpc_enqueue_job` (security definer; `jobs` itself has no insert policy for
 * any role). This is the RLS-scoped client, not the admin one: enqueueing is
 * something an ordinary user session does (confirmUpload, after a real
 * upload), not a job-runner-only operation. `runner.ts`'s claim/finish, and a
 * cron route's own self-enqueue of a scheduled job, are the service_role
 * side of this and live there instead.
 */
export async function enqueue(
  name: string,
  payload: unknown = {},
  opts: { idempotencyKey?: string; runAfter?: Date } = {}
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_enqueue_job", {
    p_name: name,
    p_payload: payload as never,
    p_idempotency_key: opts.idempotencyKey,
    p_run_after: (opts.runAfter ?? new Date()).toISOString(),
  });
  if (error) throw new Error(error.message);
  return data;
}
