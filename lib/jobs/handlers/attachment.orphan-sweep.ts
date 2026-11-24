import "server-only";
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { r2Client } from "@/lib/r2/client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Weekly (build §3.5): find R2 objects in the app bucket that no database row
 * references, older than 24 hours, and — only when the owner has opted in —
 * delete them.
 *
 * APX-06. The first version loaded its keep-list with ONE unpaged
 * `select r2_key, thumb_r2_key from attachments`. PostgREST caps that at
 * 1,000 rows without saying so, so once the table passed 1,000 rows every
 * object belonging to a row past the cap looked orphaned and was deleted:
 * real site photos, drawings and bill PDFs, a few more every Sunday. This
 * version never asks the database for "everything". It asks, for each page
 * of keys R2 lists, which of THOSE keys are referenced
 * (`rpc_r2_keys_referenced`, migration 20261124600005 — attachments
 * including soft-deleted rows, thumbnails, org logos). The answer for a page
 * is bounded by the page, so no cap can truncate it.
 *
 * Three further guards, each of which would have stopped the original bug:
 *
 * 1. **Dry run by default.** Nothing is deleted unless ORPHAN_SWEEP_DELETE is
 *    "true" in the environment AND the payload does not ask for a dry run.
 * 2. **Circuit breaker.** The whole bucket is scanned before anything is
 *    deleted. If more than 1% of scanned objects look orphaned, the sweep
 *    deletes nothing and fails loudly (the job lands on the Failed Jobs page):
 *    a healthy bucket has almost no orphans, so a large share means the check
 *    itself is wrong. At very low volumes a handful of genuine orphans can
 *    trip it too; that is the safe direction to err in.
 * 3. **Re-check before delete.** Candidates are checked against the database
 *    a second time immediately before deletion, so a row recorded between the
 *    scan and the delete keeps its object.
 *
 * The 24-hour floor is unchanged and still essential: a shorter window races
 * `confirmUpload` and deletes a file that is mid-upload, not orphaned.
 *
 * Counts are always logged; every deleted (or would-delete) key is logged too.
 */

/** More than this share of scanned objects looking orphaned aborts the sweep. */
export const ORPHAN_ABORT_RATIO = 0.01;
/** Keys per `rpc_r2_keys_referenced` call — well under PostgREST's 1,000-row
 *  response cap, so the answer can never be truncated. */
export const KEY_CHECK_BATCH = 500;
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

export type OrphanSweepSummary = {
  mode: "dry-run" | "delete";
  /** Every object listed. */
  scanned: number;
  /** Younger than 24 hours — skipped, could be mid-upload. */
  tooYoung: number;
  /** Old enough and referenced by a row. */
  referenced: number;
  /** Old enough and referenced by nothing. */
  orphaned: number;
  deleted: number;
  /** True when the circuit breaker stopped the sweep. */
  tripped: boolean;
};

type Supabase = ReturnType<typeof createAdminClient>;

/** Which of `keys` some row still references. Throws on any database error —
 *  an unanswered question must never read as "not referenced". */
async function referencedKeys(supabase: Supabase, keys: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < keys.length; i += KEY_CHECK_BATCH) {
    const batch = keys.slice(i, i + KEY_CHECK_BATCH);
    const { data, error } = await supabase.rpc("rpc_r2_keys_referenced", { p_keys: batch });
    if (error) throw new Error(`attachment.orphan_sweep: key check failed: ${error.message}`);
    for (const key of data ?? []) found.add(key);
  }
  return found;
}

function isDryRun(payload: unknown): boolean {
  const requested = (payload as { dryRun?: unknown } | null | undefined)?.dryRun;
  if (requested === true) return true;
  return !env.ORPHAN_SWEEP_DELETE;
}

export async function runOrphanSweep(payload?: unknown): Promise<OrphanSweepSummary> {
  const dryRun = isDryRun(payload);
  const cutoffMs = Date.now() - MIN_AGE_MS;
  const supabase = createAdminClient();
  const summary: OrphanSweepSummary = {
    mode: dryRun ? "dry-run" : "delete",
    scanned: 0,
    tooYoung: 0,
    referenced: 0,
    orphaned: 0,
    deleted: 0,
    tripped: false,
  };

  // ── Pass 1: scan every page, checking each page's keys against the DB ──────
  const candidates: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await r2Client().send(
      new ListObjectsV2Command({
        Bucket: env.R2_BUCKET,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    );

    const eligible: string[] = [];
    for (const obj of page.Contents ?? []) {
      summary.scanned++;
      if (!obj.Key || !obj.LastModified || obj.LastModified.getTime() >= cutoffMs) {
        summary.tooYoung++; // too young (or unreadable) — never a candidate
        continue;
      }
      eligible.push(obj.Key);
    }

    const referenced = await referencedKeys(supabase, eligible);
    for (const key of eligible) {
      if (referenced.has(key)) summary.referenced++;
      else candidates.push(key);
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  summary.orphaned = candidates.length;

  // ── Circuit breaker: decided over the WHOLE bucket, before any delete ──────
  if (summary.scanned > 0 && summary.orphaned / summary.scanned > ORPHAN_ABORT_RATIO) {
    summary.tripped = true;
    console.error(
      `attachment.orphan_sweep: circuit breaker — ${summary.orphaned} of ${summary.scanned} object(s) ` +
        `look orphaned (> ${ORPHAN_ABORT_RATIO * 100}%). Nothing deleted. ${JSON.stringify(summary)}`
    );
    return summary;
  }

  // ── Pass 2: re-check, then delete (or report) ──────────────────────────────
  const stillReferenced =
    candidates.length > 0 ? await referencedKeys(supabase, candidates) : new Set<string>();
  for (const key of candidates) {
    if (stillReferenced.has(key)) {
      summary.orphaned--;
      summary.referenced++;
      continue;
    }
    if (dryRun) {
      console.log(`attachment.orphan_sweep: [dry run] would delete ${key}`);
      continue;
    }
    await r2Client().send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    summary.deleted++;
    console.log(`attachment.orphan_sweep: deleted ${key}`);
  }

  console.log(`attachment.orphan_sweep: ${JSON.stringify(summary)}`);
  return summary;
}

/** The registry entry. A tripped circuit breaker in DELETE mode fails the job,
 *  so it reaches the Failed Jobs page; in a dry run it is only reported. */
export async function sweepOrphanAttachments(payload?: unknown): Promise<void> {
  const summary = await runOrphanSweep(payload);
  if (summary.tripped && summary.mode === "delete") {
    throw new Error(
      `ORPHAN_SWEEP_ABORTED: ${summary.orphaned} of ${summary.scanned} objects looked orphaned ` +
        `(over ${ORPHAN_ABORT_RATIO * 100}%); nothing was deleted`
    );
  }
}
