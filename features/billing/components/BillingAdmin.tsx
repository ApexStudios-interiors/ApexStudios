"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Decimal } from "decimal.js";
import { useApp } from "@/context/AppContext";
import { createBill, getBillableNowForAdmin, transitionBill } from "@/features/billing/actions";
import type { BillableNowLine, BillDTO, UnlistedMaterials } from "@/features/billing/queries";
import {
  lineBlock,
  lineKey,
  previewBill,
  selectAllLines,
  selectionIssue,
  toggleLine,
  type SelectableLine,
} from "@/features/billing/service";
import { formatINR, formatINRCompact } from "@/lib/money";
import { dmy } from "@/lib/format";
import type { Page } from "@/lib/pagination";
import { TablePagination } from "@/components/shared/TablePagination";
import { StatBar } from "@/components/ui/StatBar";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/Badge";
import { BillStatusBadge } from "@/components/shared/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CreateBillDialog } from "./CreateBillDialog";
import { ConfirmBillingActionDialog } from "./ConfirmBillingActionDialog";

type Rates = {
  gstRatePct: number;
  retentionPct: number;
  tdsPct: number;
  mobilisationAdvance: number;
  mobilisationRecovered: number;
  mobilisationRecoveryPct: number;
};

type Stats = {
  billedToDate: number;
  billedCount: number;
  received: number;
  paidCount: number;
  outstanding: number;
  billableNowValue: number;
};

/** What a draft row's Submit / Cancel draft is waiting to be confirmed. */
type PendingTransition = { kind: "submit" | "cancel"; bill: BillDTO };

const CONNECTION_LOST =
  "The connection dropped before an answer came back. Trying again is safe: the same request cannot create a second bill.";

function unlistedNote(u: UnlistedMaterials): string | null {
  const parts = [
    u.noRate ? `${u.noRate} ha${u.noRate === 1 ? "s" : "ve"} no rate` : null,
    u.noPhase
      ? `${u.noPhase} ${u.noPhase === 1 ? "is" : "are"} not linked to a phase (package-level material is not billed as an advance)`
      : null,
    u.coveredByPhaseBill
      ? `${u.coveredByPhaseBill} ${u.coveredByPhaseBill === 1 ? "is" : "are"} covered by a phase already on a bill`
      : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const total = u.noRate + u.noPhase + u.coveredByPhaseBill;
  return `${total} delivered material${total === 1 ? " is" : "s are"} not listed: ${parts.join("; ")}.`;
}

export function BillingAdmin({
  projectId,
  clientName,
  bills,
  stats,
  rates,
}: {
  projectId: string;
  clientName: string;
  /** One page of bills (features/billing/queries.ts), plus the totals the
   *  footer needs — the stat row's own counts come from `stats`, so they do
   *  not change with the page. */
  bills: Page<BillDTO>;
  stats: Stats;
  rates: Rates;
}) {
  const { openDialog, toast } = useApp();
  const router = useRouter();
  const [items, setItems] = useState<BillableNowLine[] | null>(null);
  const [unlisted, setUnlisted] = useState<UnlistedMaterials | null>(null);
  // APX-17: nothing is ticked on load. Every line goes on a bill because
  // someone chose it — the header checkbox selects all in one click.
  const [sel, setSel] = useState<Set<string>>(() => new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // One key per Create Bill confirmation. Kept when an attempt's answer was
  // lost (a retry must find the bill that may already exist, not make a
  // second one); replaced after any definite answer, and whenever the dialog
  // is opened afresh for what may be a different selection.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const [confirming, setConfirming] = useState<PendingTransition | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Named, so the create and cancel flows below can re-run the exact same
  // fetch. The deps are `projectId` alone: `toast` comes from AppContext and
  // is not a stable reference, so including it would re-fetch on every
  // provider render.
  const loadBillable = useCallback(() => {
    return getBillableNowForAdmin(projectId)
      .then(({ lines, unlisted: u }) => {
        setItems(lines);
        setUnlisted(u);
        setSel(new Set());
      })
      .catch(() => toast("Could not load Billable Now.", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    void loadBillable();
  }, [loadBillable]);

  /** After a bill is created or a draft cancelled: the server-rendered parts
   *  (Bills table, stat bar) through router.refresh(), and Billable Now —
   *  this component's own client-side fetch, which a refresh does not re-run
   *  — reloaded, with the table back in its Loading state meanwhile so stale
   *  rows cannot be ticked and billed twice (open-issues item 9). */
  function refreshAll() {
    setItems(null);
    setSel(new Set());
    router.refresh();
    void loadBillable();
  }

  const lines: SelectableLine[] = useMemo(() => items ?? [], [items]);
  const selItems = useMemo(() => lines.filter((l) => sel.has(lineKey(l))), [lines, sel]);
  // The preview reads the same columns rpc_create_bill does (APX-30), so the
  // figures confirmed below are the figures the draft will carry.
  const preview = useMemo(() => previewBill(selItems, rates), [selItems, rates]);
  const issue = selectionIssue(selItems, preview);
  const allKeys = useMemo(() => selectAllLines(lines), [lines]);
  const allSelected = allKeys.size > 0 && [...allKeys].every((k) => sel.has(k));
  const someSelected = sel.size > 0 && !allSelected;

  // Why Create Bill cannot act, in the user's terms. `null` while the fetch
  // is still in flight or a creation is under way.
  const disabledReason =
    createPending || items === null
      ? null
      : items.length === 0
        ? "Nothing is billable yet. A phase becomes billable when all its tasks reach 100%, or when an admin marks a task-less phase complete on the package's Billing tab. Delivered materials linked to an unbilled phase appear here on their own."
        : issue === "NOTHING_SELECTED"
          ? "Select at least one item to bill."
          : issue === "MAS_SAME_BILL"
            ? "A material and its own phase cannot go on the same bill — the phase already includes it. Untick the material."
            : issue === "MAS_DRAFT_PENDING"
              ? "A selected phase has material on a draft bill. Submit or cancel that draft first."
              : issue === "MAS_EXCEEDS_GROSS"
                ? `The material advance to recover (${formatINR(preview.masRecoveryAmount)}) is more than this selection's value (${formatINR(preview.grossAmount)}). Add more items to the bill, or check the phase's value.`
                : null;

  function openCreate() {
    setIdempotencyKey(crypto.randomUUID());
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreate(period: { periodFrom?: string; periodTo?: string }) {
    if (issue) return;
    setCreatePending(true);
    setCreateError(null);
    let result: Awaited<ReturnType<typeof createBill>>;
    try {
      result = await createBill({
        projectId,
        lines: selItems.map((i) => ({ sourceType: i.sourceType, sourceId: i.sourceId })),
        idempotencyKey,
        ...period,
      });
    } catch {
      setCreatePending(false);
      setCreateError(CONNECTION_LOST);
      return;
    }
    setCreatePending(false);
    setIdempotencyKey(crypto.randomUUID());
    if (!result?.data) {
      setCreateError(result?.serverError ?? "Could not create this bill");
      return;
    }
    setCreateOpen(false);
    refreshAll();
    openDialog({ kind: "billView", billId: result.data.id });
    toast(`Draft ${result.data.refNo} created`);
  }

  async function handleTransition() {
    if (!confirming) return;
    const { kind, bill } = confirming;
    setConfirmPending(true);
    setConfirmError(null);
    let result: Awaited<ReturnType<typeof transitionBill>>;
    try {
      result = await transitionBill({
        billId: bill.id,
        toStatus: kind === "submit" ? "submitted" : "cancelled",
      });
    } catch {
      // Submit and cancel are both safe to repeat: the second call finds the
      // bill already moved and says so (ILLEGAL_TRANSITION), never acts twice.
      setConfirmPending(false);
      setConfirmError(
        "The connection dropped before an answer came back. Refresh to see whether it went through."
      );
      return;
    }
    setConfirmPending(false);
    if (!result?.data) {
      setConfirmError(
        result?.serverError ??
          (kind === "submit" ? "Could not submit this bill" : "Could not cancel this draft")
      );
      return;
    }
    setConfirming(null);
    if (kind === "cancel") {
      refreshAll();
      toast(`${bill.refNo} cancelled — its items are back in Billable Now`);
    } else {
      router.refresh();
      toast(`${bill.refNo} submitted`);
    }
  }

  const note = unlisted ? unlistedNote(unlisted) : null;

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
            sub: `${stats.billedCount} bills, incl. GST`,
          },
          {
            label: "Received",
            value: formatINRCompact(stats.received),
            sub: `${stats.paidCount} with payments`,
          },
          { label: "Outstanding", value: formatINRCompact(stats.outstanding), sub: "Payment pending" },
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
            {/* Owner decision, 2026-09-29: the reason belongs in the tooltip
                below, not beside the button. The selection summary keeps this
                spot in every state. */}
            <span className="text-muted-foreground text-sm self-center">
              {selItems.length} selected · {formatINR(preview.grossAmount)} · margin{" "}
              {formatINR(preview.marginAmount)}
            </span>
            <Tooltip>
              {/* A disabled button fires no pointer events, so the tooltip
                  hangs off a focusable wrapper instead — the same shape as
                  features/inventory/components/MinimumStockInfo.tsx. */}
              <TooltipTrigger
                render={<span />}
                tabIndex={disabledReason ? 0 : -1}
                className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Button
                  variant="primary"
                  size="sm"
                  disabled={issue !== null || createPending || items === null}
                  title={disabledReason ?? undefined}
                  onClick={openCreate}
                >
                  <Icon name="plus" className="w-[15px] h-[15px]" />
                  Create Bill
                </Button>
              </TooltipTrigger>
              {disabledReason && (
                <TooltipContent className="max-w-[260px] text-left font-normal normal-case tracking-normal">
                  {disabledReason}
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </CardHeader>
        <TableWrap>
          <thead>
            <tr>
              <th className={th} style={{ width: 36 }}>
                <input
                  type="checkbox"
                  aria-label={allSelected ? "Clear selection" : "Select all billable items"}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  disabled={allKeys.size === 0}
                  onChange={() => setSel(allSelected ? new Set() : allKeys)}
                />
              </th>
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
              items.map((i) => {
                const key = lineKey(i);
                const block = lineBlock(i, lines, sel);
                const reason =
                  block?.kind === "draft_pending"
                    ? `Material for this phase is on draft ${block.billNo} — submit or cancel it first`
                    : block?.kind === "phase_selected"
                      ? "Included in its phase on this bill"
                      : i.sourceType === "phase" && i.masRecovery > 0
                        ? `Recovers ${formatINR(i.masRecovery)} of material already billed`
                        : null;
                return (
                  <tr key={key} className={block ? "text-muted-foreground" : undefined}>
                    <td className={td}>
                      <input
                        type="checkbox"
                        aria-label={`Bill ${i.description}`}
                        checked={sel.has(key)}
                        disabled={block !== null}
                        onChange={() => setSel(toggleLine(lines, sel, key))}
                      />
                    </td>
                    <td className={td}>
                      {i.description}
                      {reason && <span className={sub}>{reason}</span>}
                    </td>
                    <td className={td}>
                      {i.sourceType === "material" ? (
                        <Badge variant="outline">Material at site</Badge>
                      ) : (
                        <Badge variant="outline">Milestone</Badge>
                      )}
                    </td>
                    <td className={tdNum}>{formatINR(i.clientValue)}</td>
                    <td className={tdNum}>{formatINR(i.amount)}</td>
                    <td className={tdNum + " text-muted-foreground"}>
                      {formatINR(new Decimal(i.amount).minus(i.internalCost))}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className={td} colSpan={6}>
                  <Empty>
                    Nothing billable yet. Open a package&apos;s{" "}
                    <strong className="font-medium">Billing</strong> tab to mark a finished phase complete,
                    take a phase&apos;s last task to 100%, or mark a stock request for an unbilled phase
                    delivered — each of those puts a line here.
                  </Empty>
                </td>
              </tr>
            )}
          </tbody>
        </TableWrap>
        {note && (
          <p className="px-4 py-3 text-[12.5px] text-muted-foreground border-t border-border">{note}</p>
        )}
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
            {bills.rows.length ? (
              bills.rows.map((b) => {
                const margin = b.marginAmount ?? 0;
                let action: ReactNode = null;
                if (b.status === "draft") {
                  // "Submit -> Mark Paid; never Mark Certified" (build §4.5).
                  // Both draft actions confirm first, with the amounts (APX-17,
                  // APX-39).
                  action = (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setConfirmError(null);
                          setConfirming({ kind: "cancel", bill: b });
                        }}
                      >
                        Cancel draft
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          setConfirmError(null);
                          setConfirming({ kind: "submit", bill: b });
                        }}
                      >
                        Submit
                      </Button>
                    </>
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
                      <span className="whitespace-nowrap">{b.refNo}</span>
                      <span className={sub}>
                        {b.paidAt
                          ? `Paid ${dmy(b.paidAt)}`
                          : b.certifiedAt
                            ? `Payment pending since ${dmy(b.certifiedAt)}`
                            : b.submittedAt
                              ? `Submitted ${dmy(b.submittedAt)}`
                              : b.status === "cancelled"
                                ? "Cancelled draft"
                                : "Draft"}
                      </span>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{dmy(b.billDate)}</td>
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
        <TablePagination page={bills.page} pageSize={bills.pageSize} total={bills.total} />
      </Card>

      <CreateBillDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        lineCount={selItems.length}
        preview={preview}
        pending={createPending}
        error={createError}
        onConfirm={handleCreate}
      />

      <ConfirmBillingActionDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={
          confirming?.kind === "cancel"
            ? `Cancel draft ${confirming.bill.refNo}?`
            : `Submit ${confirming?.bill.refNo ?? "this bill"} to ${clientName}?`
        }
        confirmLabel={confirming?.kind === "cancel" ? "Cancel draft" : "Submit bill"}
        pendingLabel={confirming?.kind === "cancel" ? "Cancelling…" : "Submitting…"}
        destructive={confirming?.kind === "cancel"}
        pending={confirmPending}
        error={confirmError}
        onConfirm={handleTransition}
      >
        {confirming?.kind === "cancel" ? (
          <p>
            The draft is abandoned and its items — {formatINR(confirming.bill.taxableAmount)} taxable — go
            back to Billable Now. Nothing was sent to the client. The number {confirming.bill.refNo} stays
            with the cancelled draft and is not reused.
          </p>
        ) : confirming ? (
          <>
            <p>
              Invoice total {formatINR(confirming.bill.invoiceTotal)} (taxable{" "}
              {formatINR(confirming.bill.taxableAmount)} + GST {formatINR(confirming.bill.gstAmount)}), net
              payable{" "}
              <strong className="font-semibold text-foreground">
                {formatINR(confirming.bill.netPayable)}
              </strong>
              .
            </p>
            <p className="mt-2">
              Once submitted the bill is locked and{" "}
              {confirming.bill.submittedAt
                ? `keeps the date it was first submitted, ${dmy(confirming.bill.billDate)}`
                : "dated today"}
              . A correction afterwards is a credit note or an adjustment on the next bill, never an edit.
            </p>
          </>
        ) : null}
      </ConfirmBillingActionDialog>
    </div>
  );
}
