import { requireRole } from "@/lib/auth/session";
import { getFailedJobs } from "@/features/ops/queries";
import { dmy } from "@/lib/logic";
import { Card } from "@/components/ui/Card";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, th } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";
import { RetryJobButton } from "./RetryJobButton";

/** `dmy` plus the ISO string's own HH:MM — AGENTS.md restricts
 *  `toLocaleString`/`Intl` outside `lib/money/` broadly, not just for
 *  currency, so this stays a plain string slice rather than a Date method. */
function dmyTime(iso: string): string {
  return `${dmy(iso.slice(0, 10))} ${iso.slice(11, 16)}`;
}

/**
 * build/06-files-jobs-daily-updates.md §3.7. Admin-only, expanded in
 * Build 10. `requireRole` throws (rather than hiding a nav link) — this
 * page's own data is real failure detail (payloads, error messages), not
 * something to render-then-hide.
 */
export default async function FailedJobsPage() {
  await requireRole(["owner", "admin"]);
  const jobs = await getFailedJobs();

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[26px] font-bold tracking-tight">Failed Jobs</h1>
        <p className="mt-1 text-muted-foreground text-[13.5px]">{jobs.length} job(s) need attention</p>
      </div>
      <Card>
        {jobs.length === 0 ? (
          <Empty>No failed jobs.</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Job</th>
                <th className={th}>Payload</th>
                <th className={th}>Attempts</th>
                <th className={th}>Last Error</th>
                <th className={th}>Finished</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className={td}>{job.name}</td>
                  <td className={`${td} max-w-[240px]`}>
                    <pre className="text-[11px] whitespace-pre-wrap break-all text-muted-foreground">
                      {JSON.stringify(job.payload)}
                    </pre>
                  </td>
                  <td className={td}>
                    {job.attempts} / {job.maxAttempts}
                  </td>
                  <td className={`${td} max-w-[320px] text-destructive`}>{job.lastError ?? "—"}</td>
                  <td className={td}>{job.finishedAt ? dmyTime(job.finishedAt) : "—"}</td>
                  <td className={td}>
                    <RetryJobButton id={job.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
