import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * build/06-files-jobs-daily-updates.md §3.7: a minimal admin surface now,
 * expanded in Build 10. `jobs` has exactly one select policy (admin-only,
 * pgTAP-asserted) — this is a plain RLS-scoped read, not a bypass.
 */
export type FailedJob = {
  id: string;
  name: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  finishedAt: string | null;
};

export async function getFailedJobs(): Promise<FailedJob[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, name, payload, attempts, max_attempts, last_error, finished_at")
    .eq("status", "failed")
    .order("finished_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    lastError: r.last_error,
    finishedAt: r.finished_at,
  }));
}
