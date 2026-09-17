"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "@/context/AppContext";
import { DialogShell } from "@/components/ui/DialogShell";
import { BillStatusBadge } from "@/components/shared/StatusBadges";
import { BillFiles } from "@/features/billing/components/BillFiles";
import { getBillDetailForDialog, getBillPdfUrl } from "@/features/billing/actions";
import type { BillDetail } from "@/features/billing/queries";
import { formatINR } from "@/lib/money";
import { dmy } from "@/lib/logic";
import { Button } from "@/components/ui/button";

function Row({
  label,
  value,
  bold,
  big,
}: {
  label: string;
  value: ReactNode;
  bold?: boolean;
  big?: boolean;
}) {
  return (
    <div
      className={`flex justify-between px-1 border-b border-border text-[13.5px] ${bold ? "font-bold" : ""} ${
        big ? "text-[15px] border-b-0 pt-2.5" : "py-1.5"
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * build/09-billing.md §4.5. The corrected summary order — a visible change
 * from the prototype, which showed retention before GST:
 *
 *   Gross -> less MAS recovery -> Taxable -> + GST = Invoice total
 *                                          -> less Retention, TDS, Advance = Net Payable
 *
 * The Admin-only "Internal" box shows cost and margin — the client's own
 * dialog never fetches them in the first place (`getBillDetailForDialog`
 * branches on role server-side; there is no client-side hiding here).
 */
export function BillViewDialog({ billId }: { billId: string }) {
  const { role, closeDialog, openDialog, toast } = useApp();
  const [detail, setDetail] = useState<BillDetail | null | undefined>(undefined);
  const isAdmin = role === "owner" || role === "admin";

  useEffect(() => {
    getBillDetailForDialog(billId)
      .then(setDetail)
      .catch(() => toast("Could not load this bill."));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for this dialog instance
  }, [billId]);

  if (detail === undefined) {
    return (
      <DialogShell title="Loading…" okLabel="Close" onOk={closeDialog} onClose={closeDialog}>
        <p className="text-muted-foreground text-sm">Loading bill…</p>
      </DialogShell>
    );
  }
  if (detail === null) return null;

  const { bill, lines, billCopyUrls } = detail;

  return (
    <DialogShell
      title={`Bill ${bill.refNo}`}
      description={
        <>
          {dmy(bill.billDate)} · <BillStatusBadge status={bill.status} />
        </>
      }
      okLabel={isAdmin ? "Download Excel" : "Download PDF"}
      onClose={closeDialog}
      onOk={async () => {
        if (isAdmin) {
          window.open(`/api/bills/${bill.id}/export.xlsx`, "_blank");
          return;
        }
        // Open the tab synchronously, inside the click's own user-gesture
        // stack, and point it at the real URL once the fetch resolves —
        // opening only after the `await` loses that gesture context and
        // every browser's popup blocker silently swallows it.
        const tab = window.open("", "_blank");
        const url = await getBillPdfUrl(bill.id);
        if (!url) {
          tab?.close();
          toast("The PDF isn't ready yet — it appears within a minute of submission.");
          return;
        }
        if (tab) tab.location.href = url;
      }}
    >
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr>
              <th className="text-left font-semibold text-[11.5px] uppercase tracking-wide text-muted-foreground px-3 py-2 border-b border-border">
                Description
              </th>
              <th className="text-right font-semibold text-[11.5px] uppercase tracking-wide text-muted-foreground px-3 py-2 border-b border-border">
                Client Value
              </th>
              <th className="text-right font-semibold text-[11.5px] uppercase tracking-wide text-muted-foreground px-3 py-2 border-b border-border">
                %
              </th>
              <th className="text-right font-semibold text-[11.5px] uppercase tracking-wide text-muted-foreground px-3 py-2 border-b border-border">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2.5 border-b border-border last:border-b-0">
                  {l.description}
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {l.sourceType === "material" ? "material at site" : ""}
                  </span>
                </td>
                <td className="px-3 py-2.5 border-b border-border last:border-b-0 text-right">
                  {formatINR(l.clientValue)}
                </td>
                <td className="px-3 py-2.5 border-b border-border last:border-b-0 text-right">
                  {l.pctBilled}%
                </td>
                <td className="px-3 py-2.5 border-b border-border last:border-b-0 text-right">
                  {formatINR(l.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col mt-3.5">
        <Row label="Gross" value={formatINR(bill.grossAmount)} />
        {bill.masRecoveryAmount > 0 && (
          <Row
            label="Less material at site previously billed"
            value={"-" + formatINR(bill.masRecoveryAmount)}
          />
        )}
        <Row label="Taxable value" value={formatINR(bill.taxableAmount)} bold />
        <Row label={`GST ${bill.gstRatePct}%`} value={formatINR(bill.gstAmount)} />
        <Row label="Invoice total" value={formatINR(bill.invoiceTotal)} bold />
        <Row label={`Less retention ${bill.retentionPct}%`} value={"-" + formatINR(bill.retentionAmount)} />
        {bill.tdsAmount > 0 && (
          <Row label={`Less TDS ${bill.tdsPct}%`} value={"-" + formatINR(bill.tdsAmount)} />
        )}
        {bill.advanceRecovery > 0 && (
          <Row label="Less mobilisation advance recovery" value={"-" + formatINR(bill.advanceRecovery)} />
        )}
        <Row label="Net payable" value={formatINR(bill.netPayable)} bold big />
      </div>

      <div className="mt-3.5 p-3 border border-border rounded-lg">
        <div className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground mb-1.5">
          Bill copy
        </div>
        {billCopyUrls.length ? (
          <BillFiles files={billCopyUrls} />
        ) : (
          <span className="text-muted-foreground text-sm">No file uploaded yet.</span>
        )}
        {isAdmin && (
          <div className="mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openDialog({ kind: "billUpload", billId: bill.id, projectId: bill.projectId })}
            >
              Upload file
            </Button>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="mt-3.5 p-3 border border-dashed border-border-strong rounded-lg bg-muted/40">
          <div className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground mb-1">
            Internal · not on the client copy
          </div>
          <Row label="Cost in this bill" value={formatINR(bill.internalCostAmount ?? 0)} />
          <Row
            label="Margin in this bill"
            value={
              <>
                {formatINR(bill.marginAmount ?? 0)}{" "}
                <span className="text-muted-foreground text-xs">
                  (
                  {bill.taxableAmount > 0
                    ? Math.round(((bill.marginAmount ?? 0) / bill.taxableAmount) * 100)
                    : 0}
                  %)
                </span>
              </>
            }
            bold
          />
        </div>
      )}
    </DialogShell>
  );
}
