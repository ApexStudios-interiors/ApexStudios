import Link from "next/link";
import type { PackagesForProject } from "@/features/packages/queries";
import { Bar } from "@/components/ui/Bar";
import { ModuleStatusBadge } from "@/components/shared/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, trClick, trTotal, sub } from "@/components/ui/table";
import { formatINR } from "@/lib/money";

/**
 * Props instead of `useApp()` (build/04-projects-packages-phases.md §4.4 step
 * 5). The column set per role comes straight from `data`'s own discriminated
 * union — a site row has no `internal` field to render even if someone tried,
 * so this cannot compile the leak, not just avoid rendering it.
 */
export function ModuleTable({
  projectId,
  data,
  projectProgressPct,
}: {
  projectId: string;
  data: PackagesForProject;
  /** `projects.progress_pct` (trigger-maintained: the allocated-weighted mean
   *  of exactly these packages, per 20260909170016_triggers_rollup.sql) — read
   *  from the project row the page already fetched, not recomputed here.
   *  AGENTS.md: a derived value is stored in exactly one place. */
  projectProgressPct: number;
}) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>Package</th>
          {data.role === "money" ? (
            <>
              <th className={thNum}>Allocated</th>
              <th className={thNum}>Internal</th>
              <th className={thNum}>Committed</th>
              <th className={thNum}>Remaining</th>
              <th className={th}>Used</th>
            </>
          ) : data.role === "client" ? (
            <th className={thNum}>Contract Value</th>
          ) : (
            <>
              <th className={th}>Phases</th>
              <th className={th}>Open Requests</th>
            </>
          )}
          <th className={th}>Progress</th>
          <th className={th}>Status</th>
        </tr>
      </thead>
      <tbody>
        {data.packages.map((p) => (
          <tr key={p.id} className={trClick}>
            <td className={td}>
              <Link href={`/projects/${projectId}/packages/${p.id}`} className="font-medium hover:underline">
                <span className="inline-block min-w-[22px] mr-1.5 text-muted-foreground tabular-nums font-medium">
                  {String(p.seqNo).padStart(2, "0")}
                </span>
                {p.name}
              </Link>
              <span className={sub} style={{ paddingLeft: 22 }}>
                {p.lead}
              </span>
            </td>
            {p.role === "money" ? (
              <>
                <td className={tdNum}>{formatINR(p.allocated)}</td>
                <td className={tdNum}>{formatINR(p.internal)}</td>
                <td className={tdNum}>{formatINR(p.committed)}</td>
                <td className={tdNum + (p.remaining < 0 ? " font-bold" : "")}>{formatINR(p.remaining)}</td>
                <td className={td}>
                  <Bar value={p.committed} of={p.internal} />
                </td>
              </>
            ) : p.role === "client" ? (
              <td className={tdNum}>{formatINR(p.contractValue)}</td>
            ) : (
              <>
                <td className={td}>{p.phaseCount}</td>
                <td className={td}>{p.openRequests}</td>
              </>
            )}
            <td className={td}>
              <Bar value={p.progressPct} of={100} />
            </td>
            <td className={td}>
              <ModuleStatusBadge
                status={p.status}
                statusLabel={p.statusLabel}
                isOverBudget={p.role === "money" ? p.isOverBudget : undefined}
              />
            </td>
          </tr>
        ))}
        {data.role === "money" ? (
          <tr className={trTotal}>
            <td className={td}>Total</td>
            <td className={tdNum}>{formatINR(data.totals.allocated)}</td>
            <td className={tdNum}>{formatINR(data.totals.internal)}</td>
            <td className={tdNum}>{formatINR(data.totals.committed)}</td>
            <td className={tdNum}>{formatINR(data.totals.remaining)}</td>
            <td className={td}>
              <Bar value={data.totals.committed} of={data.totals.internal} />
            </td>
            <td className={td}>
              <Bar value={projectProgressPct} of={100} />
            </td>
            <td className={td} />
          </tr>
        ) : data.role === "client" ? (
          <tr className={trTotal}>
            <td className={td}>Total</td>
            <td className={tdNum}>{formatINR(data.totals.allocated)}</td>
            <td className={td}>
              <Bar value={projectProgressPct} of={100} />
            </td>
            <td className={td} />
          </tr>
        ) : null}
      </tbody>
    </TableWrap>
  );
}
