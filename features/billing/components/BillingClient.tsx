"use client";

import { useApp } from "@/context/AppContext";
import type { BillDTO } from "@/features/billing/queries";
import { formatINR, formatINRCompact } from "@/lib/money";
import { dmy } from "@/lib/logic";
import type { Page } from "@/lib/pagination";
import { TablePagination } from "@/components/shared/TablePagination";
import { StatBar } from "@/components/ui/StatBar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/button";
import { BillStatusBadge } from "@/components/shared/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";

type Stats = {
  billsRaised: number;
  awaitingApproval: number;
  approvedUnpaid: number;
  paid: number;
  counts: { raised: number; awaitingApproval: number; approvedUnpaid: number; paid: number };
};

/** `bills` is one page of the client's own bills; the query already excludes
 *  drafts (features/billing/queries.ts), which is where that filter has to
 *  live now so the page, the count and the rows agree. The stat row's "N
 *  bills" come from `stats`, over every bill, not from this page. */
export function BillingClient({ bills, stats }: { bills: Page<BillDTO>; stats: Stats }) {
  const { openDialog } = useApp();

  return (
    <div>
      <div className="mb-[22px]">
        <h1 className="text-[26px] font-bold tracking-tight">Bills</h1>
        <p className="mt-1 text-muted-foreground text-[13.5px]">
          Running account bills from Apex Studios. Amounts include GST.
        </p>
      </div>

      <StatBar
        stats={[
          {
            label: "Bills Raised",
            value: formatINRCompact(stats.billsRaised),
            sub: `${stats.counts.raised} bills`,
          },
          {
            label: "Awaiting Approval",
            value: formatINRCompact(stats.awaitingApproval),
            sub: `${stats.counts.awaitingApproval} bills`,
          },
          {
            label: "Payment Pending",
            value: formatINRCompact(stats.approvedUnpaid),
            sub: `${stats.counts.approvedUnpaid} bills`,
          },
          {
            label: "Paid",
            value: formatINRCompact(stats.paid),
            sub: `${stats.counts.paid} bills`,
          },
        ]}
      />

      <Card>
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Bill</th>
              <th className={th}>Date</th>
              <th className={th}>Packages</th>
              <th className={thNum}>Taxable</th>
              <th className={thNum}>GST</th>
              <th className={thNum}>Net Payable</th>
              <th className={th}>Status</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {bills.rows.length ? (
              bills.rows.map((b) => (
                <tr key={b.id}>
                  <td className={td}>
                    {b.refNo}
                    <span className={sub}>
                      {b.paidAt
                        ? `Paid ${dmy(b.paidAt)}`
                        : b.certifiedAt
                          ? `Payment pending since ${dmy(b.certifiedAt)}`
                          : b.submittedAt
                            ? `Submitted ${dmy(b.submittedAt)}`
                            : ""}
                    </span>
                  </td>
                  <td className={td}>{dmy(b.billDate)}</td>
                  <td className={td + " text-muted-foreground"}>{b.packageLabels.join(", ")}</td>
                  <td className={tdNum}>{formatINR(b.taxableAmount)}</td>
                  <td className={tdNum}>{formatINR(b.gstAmount)}</td>
                  <td className={tdNum}>{formatINR(b.netPayable)}</td>
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
                      {b.status === "submitted" && (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => openDialog({ kind: "certifyBill", billId: b.id, refNo: b.refNo })}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => openDialog({ kind: "rejectBill", billId: b.id, refNo: b.refNo })}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
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
    </div>
  );
}
