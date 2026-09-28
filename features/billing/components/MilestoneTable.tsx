"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { markPackagePhasesComplete, markPhaseComplete } from "@/features/billing/actions";
import type { PhaseBillingRow, MaterialAtSiteRow } from "@/features/billing/queries";
import { PhaseStatusBadge } from "@/components/shared/StatusBadges";
import type { PhaseStatus } from "@/lib/logic";
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
/** `phases.billing_status` (unresolved/billable/billed/paid) collapsed to
 *  the prototype's own display-only vocabulary — "unresolved" and
 *  "billable" both read as "Pending" here, exactly like the mock's own
 *  `phStatus()` never distinguished a not-yet-billable phase from a
 *  billable-but-unbilled one either. */
const BILLING_STATUS_LABEL: Record<PhaseBillingRow["billingStatus"], PhaseStatus> = {
  unresolved: "Pending",
  billable: "Pending",
  billed: "Billed",
  paid: "Paid",
};

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
  const [bulkPending, setBulkPending] = useState(false);
  const total = phases.reduce((a, p) => a + p.allocatedAmount, 0);
  const markable = phases.filter((p) => p.canMarkComplete);
  const markableValue = markable.reduce((a, p) => a + p.allocatedAmount, 0);

  async function onMarkAll() {
    setBulkPending(true);
    const result = await markPackagePhasesComplete({ packageId });
    setBulkPending(false);
    if (!result?.data) {
      toast(result?.serverError ?? "Could not mark these phases complete");
      return;
    }
    const { marked, failed } = result.data;
    router.refresh();
    toast(
      failed
        ? `${marked} phase${marked === 1 ? "" : "s"} marked complete, ${failed} could not be`
        : `${marked} phase${marked === 1 ? "" : "s"} marked complete — now billable`
    );
  }

  async function onMarkComplete(phaseId: string) {
    const result = await markPhaseComplete({ phaseId });
    if (!result?.data) {
      toast(result?.serverError ?? "Could not mark this phase complete");
      return;
    }
    router.refresh();
    toast("Phase marked complete");
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
            <Button className="mt-2.5" size="sm" disabled={bulkPending} onClick={onMarkAll}>
              {bulkPending
                ? "Marking…"
                : `Mark all ${markable.length} complete${markable.length === 1 ? "" : " "}`}
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
                    <PhaseStatusBadge status={BILLING_STATUS_LABEL[p.billingStatus]} />
                    {p.billRefNo && <span className={sub + " text-xs"}>{p.billRefNo}</span>}
                  </td>
                  <td className={td} style={{ textAlign: "right" }}>
                    {p.canMarkComplete ? (
                      <Button size="sm" onClick={() => onMarkComplete(p.id)}>
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
                  <td className={tdNum}>{formatINR(m.billableAmount)}</td>
                  <td className={td}>
                    {m.billRefNo ? (
                      <Badge variant={m.billStatus === "paid" ? "default" : "outline"}>
                        {m.billRefNo} · {m.billStatus}
                      </Badge>
                    ) : (
                      <Badge variant="outline">● Billable</Badge>
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
    </>
  );
}
