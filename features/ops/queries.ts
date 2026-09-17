import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchPage, type Page, type PageRequest } from "@/lib/pagination";

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

/** One page at a time (`count: "exact"` + `.range()`, lib/pagination.ts),
 *  which replaces the flat `.limit(100)` this used to cap the list at: the
 *  101st failure is now reachable instead of invisible. `id` breaks ties
 *  between jobs that finished in the same millisecond. */
export async function getFailedJobs(req: PageRequest): Promise<Page<FailedJob>> {
  const supabase = await createClient();
  const page = await fetchPage(
    (from, to) =>
      supabase
        .from("jobs")
        .select("id, name, payload, attempts, max_attempts, last_error, finished_at", { count: "exact" })
        .eq("status", "failed")
        .order("finished_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    req
  );
  const rows = page.rows.map((r) => ({
    id: r.id,
    name: r.name,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    lastError: r.last_error,
    finishedAt: r.finished_at,
  }));
  return { ...page, rows };
}
