import "server-only";
import { thumbnailAttachment } from "./handlers/attachment.thumbnail";
import { sweepOrphanAttachments } from "./handlers/attachment.orphan-sweep";
import { reconcileInventory } from "./handlers/inventory.reconcile";
import { archiveCompletedProjects } from "./handlers/project.archive";
import { verifyBackup } from "./handlers/backup.verify";
import { generateBillPdf } from "./handlers/bill.pdf";

/**
 * build/06-files-jobs-daily-updates.md §3.1: "the single place a job name
 * exists." `runner.ts` dispatches by looking a claimed row's `name` up here;
 * a name with no entry is a bug (an enqueue for a job the runner doesn't
 * know), not a payload the handler should try to interpret.
 */
export type JobHandler = (payload: unknown, jobId: string) => Promise<void>;

export const JOB_REGISTRY: Record<string, JobHandler> = {
  "attachment.thumbnail": thumbnailAttachment,
  "attachment.orphan_sweep": sweepOrphanAttachments,
  "inventory.reconcile": reconcileInventory,
  "project.archive": archiveCompletedProjects,
  "backup.verify": verifyBackup,
  "bill.pdf": generateBillPdf,
};

/** The names `jobs.drain` claims on every tick — every registered job.
 *
 *  It used to be only the two enqueued ad hoc from a request path, on the
 *  theory that a scheduled job is claimed by its own cron entry. But that
 *  entry runs once a day (or week): a scheduled job that FAILED was backed
 *  off by rpc_finish_job and then sat `pending` until the next day's tick —
 *  a failed backup.verify retried 24 hours later, not in minutes (APX-23).
 *  Draining them too gives every job the same 1/2/4/8/16-minute retry curve.
 *  The cron route still self-enqueues and runs each one on schedule; the
 *  drain only picks up the retries. Idempotency keys (a date or ISO week)
 *  keep that from ever becoming a second run of the same period. */
export const DRAIN_JOB_NAMES = [
  "attachment.thumbnail",
  "bill.pdf",
  "inventory.reconcile",
  "attachment.orphan_sweep",
  "project.archive",
  "backup.verify",
] as const;
