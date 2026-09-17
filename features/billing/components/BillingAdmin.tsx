"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { createBill, getBillableNowForAdmin, transitionBill } from "@/features/billing/actions";
import type { BillableNowLine, BillDTO } from "@/features/billing/queries";
import { previewBill, type BillableLine } from "@/features/billing/service";
import { formatINR, formatINRCompact } from "@/lib/money";
import { dmy } from "@/lib/logic";
import { StatBar } from "@/components/ui/StatBar";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/Badge";
import { BillStatusBadge } from "@/components/shared/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";

type Rates = {
  gstRatePct: number;
  retentionPct: number;
  tdsPct: number;
  mobilisationAdvance: number;
  mobilisationRecovered: number;
  mobilisationRecoveryPct: number;
};

type Stats = { billedToDate: number; received: number; outstanding: number; billableNowValue: number };

export function BillingAdmin({
  projectId,
  clientName,
  bills,
  stats,
  rates,
}: {
  projectId: string;
  clientName: string;
  bills: BillDTO[];
  stats: Stats;
  rates: Rates;
}) {
  const { openDialog, toast } = useApp();
  const router = useRouter();
  const [items, setItems] = useState<BillableNowLine[] | null>(null);
  const [selKeys, setSelKeys] = useState<Set<string> | null>(null);
  const [pending, setPending] = useState(false);
  // Regenerated after every attempt, success or failure — this component
  // stays mounted across many separate bill creations over a project's
  // life, unlike a dialog that closes and remounts one. A key fixed for the
  // component's whole lifetime would make every creation AFTER the first
  // one silently collide with it under rpc_create_bill's own idempotency
  // check, returning the first bill again instead of creating a new one.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  // Named, so the create flow below can re-run the exact same fetch. The
  // deps are `projectId` alone, as before: `toast` comes from AppContext and
  // is not a stable reference, so including it would re-fetch on every
  // provider render.
  const loadBillable = useCallback(() => {
    return getBillableNowForAdmin(projectId)
      .then((rows) => {
        setItems(rows);
        setSelKeys(new Set(rows.map((r) => r.sourceId)));
      })
      .catch(() => toast("Could not load Billable Now."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    void loadBillable();
  }, [loadBillable]);

  const sel = useMemo(() => selKeys ?? new Set<string>(), [selKeys]);
  const selItems = useMemo(() => (items ?? []).filter((i) => sel.has(i.sourceId)), [items, sel]);
  const preview = useMemo(() => {
    // The query DTO -> service input mapping (`toBillableLines` in
    // queries.ts) is inlined here rather than imported: queries.ts is
    // server-only and a component may never import it directly, even for a
    // pure helper (code-standards §1).
    const lines: BillableLine[] = selItems.map((i) => ({
      sourceType: i.sourceType,
      amount: i.amount,
      internalCost: i.internalCost,
      priorMaterialAdvanceOnThisPhase: i.priorMaterialAdvanceOnThisPhase,
    }));
    return previewBill(lines, rates);
  }, [selItems, rates]);

  const toggle = (sourceId: string) => {
    const next = new Set(sel);
    if (next.has(sourceId)) next.delete(sourceId);
    else next.add(sourceId);
    setSelKeys(next);
  };

  async function handleCreate() {
    if (!selItems.length) return;
    setPending(true);
    const result = await createBill({
      projectId,
      lines: selItems.map((i) => ({ sourceType: i.sourceType, sourceId: i.sourceId })),
      idempotencyKey,
    });
    setPending(false);
    setIdempotencyKey(crypto.randomUUID());
    if (!result?.data) {
      toast(result?.serverError ?? "Could not create this bill");
      return;
    }
    // `router.refresh()` picks up createBill's own updateTag/revalidatePath
    // for everything server-rendered on this page (the Bills table, the stat
    // bar). Billable Now is this component's own client-side fetch and a
    // refresh does not re-run it — without the reload the rows just billed
    // stay listed and tickable, and re-submitting them produces an
    // ALREADY_BILLED the admin did not cause. `setItems(null)` puts the
    // table back into its Loading state meanwhile, rather than leaving
    // stale rows selectable while the fetch is in flight.
    setItems(null);
    setSelKeys(null);
    router.refresh();
    void loadBillable();
    openDialog({ kind: "billView", billId: result.data.id });
    toast(`Bill ${result.data.refNo} created`);
  }

  return (
    <div>
      <div className="mb-[22px]">
        <h1 className="text-[26px] font-bold tracking-tight">Billing</h1>
        <p className="mt-1 text-muted-foreground text-[13.5px]">
          RA bills to {clientName}. All values at client price, ex GST unless shown.
        </p>
      </div>

      <StatBar
        stats={[
          {
            label: "Billed to Date",
            value: formatINRCompact(stats.billedToDate),
            sub: `${bills.filter((b) => b.status !== "draft").length} bills, incl. GST`,
          },
          {
            label: "Received",
            value: formatINRCompact(stats.received),
            sub: `${bills.filter((b) => b.status === "paid").length} paid`,
          },
          { label: "Outstanding", value: formatINRCompact(stats.outstanding), sub: "Certified, not paid" },
          {
            label: "Billable Now",
            value: formatINRCompact(stats.billableNowValue),
            sub: `${items?.length ?? 0} items ready`,
          },
        ]}
      />

      <Card className="mb-5">
        <CardHeader>
          <h3>Billable Now</h3>
          <div className="ml-auto flex gap-2 items-center">
            <span className="text-muted-foreground text-sm self-center">
              {selItems.length} selected · {formatINR(preview.grossAmount)} · margin{" "}
              {formatINR(preview.marginAmount)}
            </span>
            <Button variant="primary" size="sm" disabled={!selItems.length || pending} onClick={handleCreate}>
              <Icon name="plus" className="w-[15px] h-[15px]" />
              {pending ? "Creating…" : "Create Bill"}
            </Button>
          </div>
        </CardHeader>
        <TableWrap>
          <thead>
            <tr>
              <th className={th} style={{ width: 36 }}></th>
              <th className={th}>Item</th>
              <th className={th}>Type</th>
              <th className={thNum}>Client Value</th>
              <th className={thNum}>Billable</th>
              <th className={thNum}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {items === null ? (
              <tr>
                <td className={td} colSpan={6}>
                  <Empty>Loading…</Empty>
                </td>
              </tr>
            ) : items.length ? (
              items.map((i) => (
                <tr key={i.sourceId}>
                  <td className={td}>
                    <input
                      type="checkbox"
                      checked={sel.has(i.sourceId)}
                      onChange={() => toggle(i.sourceId)}
                    />
                  </td>
                  <td className={td}>{i.description}</td>
                  <td className={td}>
                    {i.sourceType === "material" ? (
                      <Badge variant="outline">Material at site</Badge>
                    ) : (
                      <Badge variant="outline">Milestone</Badge>
                    )}
                  </td>
                  <td className={tdNum}>{formatINR(i.clientValue)}</td>
                  <td className={tdNum}>{formatINR(i.amount)}</td>
                  <td className={tdNum + " text-muted-foreground"}>{formatINR(i.amount - i.internalCost)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className={td} colSpan={6}>
                  <Empty>
                    Nothing billable yet. Items appear here when materials are delivered or milestones
                    complete.
                  </Empty>
                </td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <CardHeader>
          <h3>Bills</h3>
        </CardHeader>
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Bill</th>
              <th className={th}>Date</th>
              <th className={th}>Packages</th>
              <th className={thNum}>Taxable</th>
              <th className={thNum}>Net Payable</th>
              <th className={thNum}>Margin</th>
              <th className={th}>Status</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {bills.length ? (
              bills.map((b) => {
                const margin = b.marginAmount ?? 0;
                let action: ReactNode = null;
                if (b.status === "draft") {
                  // "Submit -> Mark Paid; never Mark Certified" (build §4.5)
                  // — the admin's own next action after draft is always
                  // Submit, never a direct status flip past it.
                  action = (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={async () => {
                        const result = await transitionBill({ billId: b.id, toStatus: "submitted" });
                        if (!result?.data) toast(result?.serverError ?? "Could not submit this bill");
                        else {
                          router.refresh();
                          toast(`${b.refNo} submitted`);
                        }
                      }}
                    >
                      Submit
                    </Button>
                  );
                } else if (b.status === "certified") {
                  action = (
                    <Button
                      size="sm"
                      onClick={() =>
                        openDialog({
                          kind: "recordPayment",
                          billId: b.id,
                          refNo: b.refNo,
                          netPayable: b.netPayable,
                        })
                      }
                    >
                      Record Payment
                    </Button>
                  );
                }
                return (
                  <tr key={b.id}>
                    <td className={td}>
                      {b.refNo}
                      <span className={sub}>
                        {b.paidAt
                          ? `Paid ${dmy(b.paidAt)}`
                          : b.certifiedAt
                            ? `Certified ${dmy(b.certifiedAt)}`
                            : b.submittedAt
                              ? `Submitted ${dmy(b.submittedAt)}`
                              : "Draft"}
                      </span>
                    </td>
                    <td className={td}>{dmy(b.billDate)}</td>
                    <td className={td + " text-muted-foreground"}>{b.packageLabels.join(", ")}</td>
                    <td className={tdNum}>{formatINR(b.taxableAmount)}</td>
                    <td className={tdNum}>{formatINR(b.netPayable)}</td>
                    <td className={tdNum + " text-muted-foreground"}>
                      {formatINR(margin)}{" "}
                      <span className="text-xs">
                        ({b.taxableAmount > 0 ? Math.round((margin / b.taxableAmount) * 100) : 0}%)
                      </span>
                    </td>
                    <td className={td}>
                      <BillStatusBadge status={b.status} />
                    </td>
                    <td className={td}>
                      <div className="flex gap-1.5 flex-wrap justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDialog({ kind: "billView", billId: b.id })}
                        >
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDialog({ kind: "billUpload", billId: b.id, projectId })}
                        >
                          Upload
                        </Button>
                        {action}
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className={td} colSpan={8}>
                  <Empty>No bills yet.</Empty>
                </td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
