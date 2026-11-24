import type { PhasesForPackage } from "@/features/packages/queries";
import { Bar } from "@/components/ui/Bar";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, tdSeq, tdTop, th, thNum, thSeq, trTotal } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";
import { formatINR } from "@/lib/money";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { Badge } from "@/components/ui/Badge";

/** Props instead of `useApp()` — the phase-level counterpart of ModuleTable's
 *  same conversion (build/04-projects-packages-phases.md §4.4 step 5). */
export function PhaseTable({
  data,
  edit,
}: {
  data: PhasesForPackage;
  /** APX-10: admin only, and not on a read-only (archived) project — an Edit
   *  button per row opening Edit Phase. */
  edit?: { projectId: string; moduleId: string };
}) {
  if (!data.phases.length) {
    return (
      <Empty>
        No phases yet.{" "}
        {data.role === "money"
          ? "Add one to start scheduling and billing this package."
          : "An admin adds them; tasks and billing hang off phases."}
      </Empty>
    );
  }

  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={thSeq}>#</th>
          <th className={th}>Phase</th>
          {data.role === "money" ? (
            <>
              <th className={thNum}>Allocated</th>
              <th className={thNum}>Internal</th>
              <th className={thNum}>Committed</th>
              <th className={thNum}>Remaining</th>
              <th className={th}>Used</th>
              {edit && <th className={th} />}
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
            <td className={tdSeq}>{String(p.seqNo).padStart(2, "0")}</td>
            <td className={tdTop}>
              {p.name}
              {p.role === "money" && p.billed && (
                <Badge variant="secondary" className="ml-2">
                  Billed
                </Badge>
              )}
            </td>
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
                {edit && (
                  <td className={td} style={{ textAlign: "right" }}>
                    <OpenDialogButton
                      variant="ghost"
                      size="sm"
                      dialog={{
                        kind: "editPhase",
                        projectId: edit.projectId,
                        moduleId: edit.moduleId,
                        phaseId: p.id,
                      }}
                    >
                      Edit
                    </OpenDialogButton>
                  </td>
                )}
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
            <td className={td} colSpan={2}>
              Total
            </td>
            <td className={tdNum}>{formatINR(data.totals.allocated)}</td>
            <td className={tdNum}>{formatINR(data.totals.internal)}</td>
            <td className={tdNum}>{formatINR(data.totals.committed)}</td>
            <td className={tdNum}>{formatINR(data.totals.internal - data.totals.committed)}</td>
            <td className={td}>
              <Bar value={data.totals.committed} of={data.totals.internal} />
            </td>
            {edit && <td className={td} />}
          </tr>
        ) : data.role === "client" ? (
          <tr className={trTotal}>
            <td className={td} colSpan={2}>
              Total
            </td>
            <td className={tdNum}>{formatINR(data.totals.allocated)}</td>
          </tr>
        ) : null}
      </tbody>
    </TableWrap>
  );
}
