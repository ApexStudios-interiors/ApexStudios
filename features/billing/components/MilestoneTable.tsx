"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { markPackagePhasesComplete, markPhaseComplete } from "@/features/billing/actions";
import type { PhaseBillingRow, MaterialAtSiteRow } from "@/features/billing/queries";
import { PhaseStatusBadge } from "@/components/shared/StatusBadges";
import { phaseBillingLabel } from "@/features/billing/service";
import { ConfirmBillingActionDialog } from "./ConfirmBillingActionDialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/money";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, trTotal, sub } from "@/components/ui/table";
import { Card, CardHeader } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";

/** ui-guide §6.5's Package Billing tab, admin only: "Phase billing status"
 *  (Phase, Tasks done, Bill Amount, Status, Mark Complete) and "Material at
 *  Site" (Cost, Client Value, Billable, Status). `rpc_mark_phase_complete`
 *  predates this build (migration 20260911090001) — this is its own Server
 *  Action wiring, as that migration's own comment says would land here. */
/** The Material at Site status line for a material that is not on a bill:
 *  billable, or why not (MAS rules R1/R4/R6, migration 20261124200001). */
const MATERIAL_STATE_LABEL: Record<Exclude<MaterialAtSiteRow["state"], "billed">, string> = {
  billable: "● Billable",
  no_rate: "No rate — not billable",
  no_phase: "No phase — not billed as an advance",
  covered_by_phase: "Covered by its phase's bill",
};

type MarkConfirm = { kind: "one"; phase: PhaseBillingRow } | { kind: "all" };

export function MilestoneTable({
  phases,
  materials,
  packageId,
  packageStatus,
}: {
  phases: PhaseBillingRow[];
  materials: MaterialAtSiteRow[];
  packageId: string;
  /** `packages.status`. Billing never reads it — that is the whole point of
   *  the note below, which exists because testing found someone marking a
   *  package "completed" and then looking for it in Create Bill. */
  packageStatus: "not_started" | "design" | "in_progress" | "completed";
}) {
  const { toast } = useApp();
  const router = useRouter();
  const [confirm, setConfirm] = useState<MarkConfirm | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = phases.reduce((a, p) => a + p.allocatedAmount, 0);
  const markable = phases.filter((p) => p.canMarkComplete);
  const markableValue = markable.reduce((a, p) => a + p.allocatedAmount, 0);

  function ask(next: MarkConfirm) {
    setError(null);
    setConfirm(next);
  }

  // APX-39: both mark actions confirm first, with the amount they make
  // billable, and hold a pending state so a double click sends one request.
  async function onConfirm() {
    if (!confirm) return;
    setPending(true);
    setError(null);
    try {
      if (confirm.kind === "all") {
        const result = await markPackagePhasesComplete({ packageId });
        if (!result?.data) {
          setError(result?.serverError ?? "Could not mark these phases complete");
          return;
        }
        const { marked, failed } = result.data;
        setConfirm(null);
        router.refresh();
        toast(
          failed
            ? `${marked} phase${marked === 1 ? "" : "s"} marked complete, ${failed} could not be`
            : `${marked} phase${marked === 1 ? "" : "s"} marked complete — now billable`
        );
      } else {
        const result = await markPhaseComplete({ phaseId: confirm.phase.id });
        if (!result?.data) {
          setError(result?.serverError ?? "Could not mark this phase complete");
          return;
        }
        setConfirm(null);
        router.refresh();
        toast(`${confirm.phase.name} marked complete — now billable`);
      }
    } catch {
      setError("The connection dropped before an answer came back. Refresh to see whether it went through.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {markable.length > 0 && (
        // The explainer testing asked for. Marking a PACKAGE completed does
        // nothing for billing — only a phase becomes billable, and a phase
        // with no tasks has nothing to prove it, so it needs a person to say
        // so. Saying that once, here, where the button is, beats leaving it
        // to be rediscovered.
        <Card className="mb-4">
          <div className="px-4 py-3.5">
            <p className="text-[13.5px] font-medium text-foreground">
              {markable.length} phase{markable.length === 1 ? "" : "s"} worth {formatINR(markableValue)}{" "}
              {markable.length === 1 ? "is" : "are"} waiting to be marked complete.
            </p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              A phase becomes billable when all its tasks reach 100%, or — when it has no tasks at all — when
              an admin marks it complete here. Marking the <strong className="font-medium">package</strong> as{" "}
              {packageStatus === "completed" ? '"completed"' : "complete"} does not do this on its own. Until
              then nothing from this package appears under Billable Now, so Create Bill has nothing to bill.
            </p>
            <Button className="mt-2.5" size="sm" disabled={pending} onClick={() => ask({ kind: "all" })}>
              Mark all {markable.length} complete
            </Button>
          </div>
        </Card>
      )}

      <Card>
        {phases.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Phase</th>
                <th className={th}>Tasks</th>
                <th className={thNum}>Bill Amount</th>
                <th className={th}>Status</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {phases.map((p) => (
                <tr key={p.id}>
                  <td className={td}>{p.name}</td>
                  <td className={td + " text-muted-foreground text-sm"}>
                    {p.taskCount ? `${p.tasksDone} of ${p.taskCount} done` : "No tasks linked"}
                  </td>
                  <td className={tdNum}>{formatINR(p.allocatedAmount)}</td>
                  <td className={td}>
                    <PhaseStatusBadge status={phaseBillingLabel(p)} />
                    {p.billRefNo && <span className={sub + " text-xs"}>{p.billRefNo}</span>}
                  </td>
                  <td className={td} style={{ textAlign: "right" }}>
                    {p.canMarkComplete ? (
                      <Button size="sm" disabled={pending} onClick={() => ask({ kind: "one", phase: p })}>
                        Mark Complete
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              <tr className={trTotal}>
                <td className={td}>Total</td>
                <td className={td} />
                <td className={tdNum}>{formatINR(total)}</td>
                <td className={td} />
                <td className={td} />
              </tr>
            </tbody>
          </TableWrap>
        ) : (
          <Empty>No phases yet.</Empty>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <h3>Material at Site</h3>
        </CardHeader>
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Material</th>
              <th className={thNum}>Cost</th>
              <th className={thNum}>Client Value</th>
              <th className={thNum}>Billable</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {materials.length ? (
              materials.map((m) => (
                <tr key={m.id}>
                  <td className={td}>
                    {m.materialName}
                    <span className={sub}>
                      {m.refNo} · {m.qty} {m.unit}
                    </span>
                  </td>
                  <td className={tdNum}>{formatINR(m.cost)}</td>
                  <td className={tdNum}>{formatINR(m.clientValue)}</td>
                  <td className={tdNum}>{m.billableAmount === null ? "—" : formatINR(m.billableAmount)}</td>
                  <td className={td}>
                    {m.billRefNo ? (
                      <Badge variant={m.billStatus === "paid" ? "default" : "outline"}>
                        {m.billRefNo} · {m.billStatus}
                      </Badge>
                    ) : m.state === "billed" ? (
                      <Badge variant="outline">Billed</Badge>
                    ) : m.state === "billable" ? (
                      <Badge variant="outline">{MATERIAL_STATE_LABEL.billable}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">{MATERIAL_STATE_LABEL[m.state]}</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className={td} colSpan={5}>
                  <Empty>Nothing delivered yet.</Empty>
                </td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      </Card>

      <ConfirmBillingActionDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.kind === "one"
            ? `Mark ${confirm.phase.name} complete?`
            : `Mark ${markable.length} phase${markable.length === 1 ? "" : "s"} complete?`
        }
        confirmLabel="Mark complete"
        pendingLabel="Marking…"
        pending={pending}
        error={error}
        onConfirm={onConfirm}
      >
        <p>
          {confirm?.kind === "one"
            ? `${formatINR(confirm.phase.allocatedAmount)} becomes billable and appears in Billable Now.`
            : `${formatINR(markableValue)} across ${markable.length} task-less phase${markable.length === 1 ? "" : "s"} becomes billable and appears in Billable Now.`}{" "}
          Only mark a phase complete when its work is actually finished: it is then billed to the client in
          full.
        </p>
      </ConfirmBillingActionDialog>
    </>
  );
}
