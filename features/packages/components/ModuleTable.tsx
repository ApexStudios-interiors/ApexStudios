import Link from "next/link";
import type { PackagesForProject } from "@/features/packages/queries";
import { Bar } from "@/components/ui/Bar";
import { ModuleStatusBadge } from "@/components/shared/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, tdSeq, tdTop, th, thNum, thSeq, trClick, trTotal, sub } from "@/components/ui/table";
import { formatINR } from "@/lib/money";
import { packageSlug } from "@/lib/routing/slug";

/**
 * Props instead of `useApp()` (build/04-projects-packages-phases.md §4.4 step
 * 5). The column set per role comes straight from `data`'s own discriminated
 * union — a site row has no `internal` field to render even if someone tried,
 * so this cannot compile the leak, not just avoid rendering it.
 */
export function ModuleTable({
  base,
  data,
  projectProgressPct,
  hideTotals = false,
}: {
  /** Canonical `/projects/<code>` for this project. */
  base: string;
  data: PackagesForProject;
  /** `projects.progress_pct` (trigger-maintained: the allocated-weighted mean
   *  of exactly these packages, per 20260909170016_triggers_rollup.sql) — read
   *  from the project row the page already fetched, not recomputed here.
   *  AGENTS.md: a derived value is stored in exactly one place. */
  projectProgressPct: number;
  /** The Packages page sets this while its search or status filter is on:
   *  the Total row totals the whole project, not the rows shown. */
  hideTotals?: boolean;
}) {
  return (
    <TableWrap>
      <thead>
        <tr>
          {/* The number is its OWN column, not a span inside the name.
              Inline, a long name wrapped underneath it — "External
              Development and Lift" put its second line hard against the cell
              edge while the first began after the number, so neither lined up
              with anything. A cell cannot wrap under its neighbour. */}
          <th className={thSeq}>#</th>
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
            {/* `align-top`, not the shared `align-middle`: on a two-line name
                the number belongs beside the FIRST line, which is where the
                reader's eye starts, not floating against the middle of the
                block. `tabular-nums` keeps 01 and 11 the same width so the
                column edge stays straight. */}
            <td className={tdSeq}>{String(p.seqNo).padStart(2, "0")}</td>
            <td className={tdTop}>
              <Link
                href={`${base}/packages/${packageSlug(p.name, p.seqNo, false)}`}
                className="font-medium hover:underline"
              >
                {p.name}
              </Link>
              {/* No padding to fake alignment any more — the lead sits in the
                  same cell as the name, so it lines up with it by itself
                  whatever width the number column takes. */}
              <span className={sub}>{p.lead}</span>
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
        {hideTotals ? null : data.role === "money" ? (
          <tr className={trTotal}>
            <td className={td} colSpan={2}>
              Total
            </td>
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
            <td className={td} colSpan={2}>
              Total
            </td>
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
