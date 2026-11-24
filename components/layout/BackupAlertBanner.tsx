import Link from "next/link";
import type { BackupAlert } from "@/features/ops/queries";

const JOB_LABEL: Record<BackupAlert["name"], string> = {
  "backup.nightly": "Last night's database backup failed",
  "backup.verify": "The backup check failed: last night's backup is missing or looks incomplete",
};

/**
 * APX-19. Admin shell only, shown while the latest run of `backup.nightly` or
 * `backup.verify` is failed. Red because it is a destructive status
 * (AGENTS.md reserves colour for status meaning), not dismissible, and it
 * clears itself once the job next succeeds. It links to the Failed Jobs page,
 * which has the error, and names the runbook to follow.
 */
export function BackupAlertBanner({ alert }: { alert: BackupAlert }) {
  return (
    <div
      role="alert"
      className="bg-destructive text-white px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12.5px] font-medium"
    >
      <span>{JOB_LABEL[alert.name]}. There may be no recent recovery point.</span>
      <Link href="/ops/jobs" className="underline underline-offset-2">
        See the failed job
      </Link>
      <span className="opacity-90">Runbook: docs/runbooks/backup-failed.md</span>
    </div>
  );
}
