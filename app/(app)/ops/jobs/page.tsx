import { requireRole } from "@/lib/auth/session";
import { getFailedJobs } from "@/features/ops/queries";
import { dmy } from "@/lib/logic";
import { parsePageRequest } from "@/lib/pagination";
import { TablePagination } from "@/components/shared/TablePagination";
import { Card } from "@/components/ui/Card";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, th } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";
import { Badge } from "@/components/ui/Badge";
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
export default async function FailedJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  await requireRole(["owner", "admin"]);
  const jobs = await getFailedJobs(parsePageRequest(await searchParams));
  // Counted on the page rather than in the query: `total` is the page's own
  // count and now spans both states, and the heading should still say how many
  // actually need a human.
  const failedCount = jobs.rows.filter((j) => j.status === "failed").length;
  const retryingCount = jobs.rows.length - failedCount;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[26px] font-bold tracking-tight">Failed Jobs</h1>
        <p className="mt-1 text-muted-foreground text-[13.5px]">
          {failedCount} job(s) need attention
          {retryingCount > 0 && `, ${retryingCount} being retried`}
        </p>
      </div>
      <Card>
        {jobs.total === 0 ? (
          <Empty>No failed jobs.</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Job</th>
                <th className={th}>Status</th>
                <th className={th}>Payload</th>
                <th className={th}>Attempts</th>
                <th className={th}>Last Error</th>
                <th className={th}>Finished</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {jobs.rows.map((job) => (
                <tr key={job.id}>
                  <td className={td}>{job.name}</td>
                  <td className={td}>
                    {job.status === "failed" ? (
                      <Badge variant="destructive">Failed</Badge>
                    ) : job.status === "running" ? (
                      <Badge variant="outline">Processing</Badge>
                    ) : (
                      <Badge variant="outline">Retry queued</Badge>
                    )}
                  </td>
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
                    {/* Only a failed job can be retried — rpc_retry_job
                        refuses anything else — so the button is replaced by
                        the reason rather than being offered and rejected. */}
                    {job.status === "failed" ? (
                      <RetryJobButton id={job.id} />
                    ) : (
                      <span className="text-[12px] text-muted-foreground">Waiting for the runner</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <TablePagination page={jobs.page} pageSize={jobs.pageSize} total={jobs.total} />
      </Card>
    </div>
  );
}
