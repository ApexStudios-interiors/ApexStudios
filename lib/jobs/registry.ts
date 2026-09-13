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

/** The names `jobs.drain` claims every minute — everything enqueued ad hoc
 *  from a request path, as opposed to a job a cron route self-enqueues on
 *  its own schedule (those are claimed by their own cron entry instead, see
 *  app/api/cron/[job]/route.ts). */
export const DRAIN_JOB_NAMES = ["attachment.thumbnail", "bill.pdf"] as const;
