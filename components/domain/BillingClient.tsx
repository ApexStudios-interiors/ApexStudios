"use client";

import { useApp } from "@/context/AppContext";
import type { BillDTO } from "@/features/billing/queries";
import { formatINR, formatINRCompact } from "@/lib/money";
import { dmy } from "@/lib/logic";
import { StatBar } from "@/components/ui/StatBar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BillStatusBadge } from "@/components/domain/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";

type Stats = { billsRaised: number; awaitingApproval: number; approvedUnpaid: number; paid: number };

export function BillingClient({ bills, stats }: { bills: BillDTO[]; stats: Stats }) {
  const { openDialog } = useApp();
  const visible = bills.filter((b) => b.status !== "draft");

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
            sub: `${visible.length} bills`,
          },
          {
            label: "Awaiting Approval",
            value: formatINRCompact(stats.awaitingApproval),
            sub: `${bills.filter((b) => b.status === "submitted").length} bills`,
          },
          {
            label: "Approved, Unpaid",
            value: formatINRCompact(stats.approvedUnpaid),
            sub: `${bills.filter((b) => b.status === "certified").length} bills`,
          },
          {
            label: "Paid",
            value: formatINRCompact(stats.paid),
            sub: `${bills.filter((b) => b.status === "paid").length} bills`,
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
            {visible.length ? (
              visible.map((b) => (
                <tr key={b.id}>
                  <td className={td}>
                    {b.refNo}
                    <span className={sub}>
                      {b.paidAt
                        ? `Paid ${dmy(b.paidAt)}`
                        : b.certifiedAt
                          ? `Approved ${dmy(b.certifiedAt)}`
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
                      <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: "billView", billId: b.id })}>
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
      </Card>
    </div>
  );
}
