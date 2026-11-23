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
  /**
   * `failed`, or `pending`/`running` for a job that failed before and is
   * being retried now. Retrying used to make the row disappear from this page
   * the instant the button was pressed, with nothing to say whether it had
   * worked; the list now follows the job until it succeeds or fails again.
   */
  status: "pending" | "running" | "failed";
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
        .select("id, name, status, payload, attempts, max_attempts, last_error, finished_at", {
          count: "exact",
        })
        // Failed jobs, plus the ones being retried right now. A pending or
        // running job that still carries `last_error` is one that failed
        // before: rpc_retry_job deliberately keeps that error (migration
        // 20260929090001) precisely so this page can tell the two apart — a
        // job that has never run has no error to carry.
        .or("status.eq.failed,and(status.in.(pending,running),last_error.not.is.null)")
        .order("finished_at", { ascending: false, nullsFirst: true })
        .order("id", { ascending: false })
        .range(from, to),
    req
  );
  const rows = page.rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status as FailedJob["status"],
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    lastError: r.last_error,
    finishedAt: r.finished_at,
  }));
  return { ...page, rows };
}

/** The backup jobs the admin-shell banner watches (APX-19). */
export const BACKUP_JOB_NAMES = ["backup.nightly", "backup.verify"] as const;

export type BackupAlert = {
  name: (typeof BACKUP_JOB_NAMES)[number];
  lastError: string | null;
  finishedAt: string | null;
};

/**
 * The most recent run of each backup job, and whether either is failed. The
 * nightly backup is the only recovery point on this tier, and a failure used
 * to be one row on the Failed Jobs page that nobody had reason to open; the
 * admin shell now shows a banner while the LATEST run of either job is
 * failed, and it clears itself the next time that job succeeds. Admin-only by
 * RLS (`jobs_select_admin`) as well as by the shell, which calls this for an
 * admin only. Bounded: a handful of rows, newest first.
 */
export async function getBackupAlert(): Promise<BackupAlert | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("name, status, last_error, finished_at, created_at")
    .in("name", [...BACKUP_JOB_NAMES])
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return latestBackupFailure(data);
}

/** Pure, for tests: the failed one among each job's newest row, if any. */
export function latestBackupFailure(
  rows: readonly { name: string; status: string; last_error: string | null; finished_at: string | null }[]
): BackupAlert | null {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.name)) continue; // only each job's newest row counts
    seen.add(row.name);
    const name = BACKUP_JOB_NAMES.find((n) => n === row.name);
    if (name && row.status === "failed") {
      return { name, lastError: row.last_error, finishedAt: row.finished_at };
    }
  }
  return null;
}
