import type { PhasesForPackage } from "@/features/packages/queries";
import { Bar } from "@/components/ui/Bar";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, trTotal } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";
import { formatINR } from "@/lib/money";

/** Props instead of `useApp()` — the phase-level counterpart of ModuleTable's
 *  same conversion (build/04-projects-packages-phases.md §4.4 step 5). */
export function PhaseTable({ data }: { data: PhasesForPackage }) {
  if (!data.phases.length) return <Empty>No phases yet.</Empty>;

  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>Phase</th>
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
            <th className={th}>Requests</th>
          )}
        </tr>
      </thead>
      <tbody>
        {data.phases.map((p) => (
          <tr key={p.id}>
            <td className={td}>{p.name}</td>
            {p.role === "money" ? (
              <>
                <td className={tdNum}>{formatINR(p.allocated)}</td>
                <td className={tdNum}>{formatINR(p.internal)}</td>
                <td className={tdNum}>
                  {p.committed ? formatINR(p.committed) : <span className="text-muted-foreground">–</span>}
                </td>
                <td className={tdNum + (p.remaining < 0 ? " font-bold" : "")}>{formatINR(p.remaining)}</td>
                <td className={td}>
                  <Bar value={p.committed} of={p.internal} />
                </td>
              </>
            ) : p.role === "client" ? (
              <td className={tdNum}>{formatINR(p.contractValue)}</td>
            ) : (
              <td className={td}>{p.requests || <span className="text-muted-foreground">–</span>}</td>
            )}
          </tr>
        ))}
        {data.role === "money" ? (
          <tr className={trTotal}>
            <td className={td}>Total</td>
            <td className={tdNum}>{formatINR(data.totals.allocated)}</td>
            <td className={tdNum}>{formatINR(data.totals.internal)}</td>
            <td className={tdNum}>{formatINR(data.totals.committed)}</td>
            <td className={tdNum}>{formatINR(data.totals.internal - data.totals.committed)}</td>
            <td className={td}>
              <Bar value={data.totals.committed} of={data.totals.internal} />
            </td>
          </tr>
        ) : data.role === "client" ? (
          <tr className={trTotal}>
            <td className={td}>Total</td>
            <td className={tdNum}>{formatINR(data.totals.allocated)}</td>
          </tr>
        ) : null}
      </tbody>
    </TableWrap>
  );
}
