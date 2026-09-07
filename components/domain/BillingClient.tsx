"use client";

import { useApp } from "@/context/AppContext";
import { Bill, Project } from "@/lib/types";
import { bills, billTotals, dmy, fmt, fmtS, mno } from "@/lib/logic";
import { StatBar } from "@/components/ui/StatBar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BillStatusBadge } from "@/components/domain/StatusBadges";
import { BillFiles } from "@/components/domain/BillFiles";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";

export function BillingClient({ project }: { project: Project }) {
  const { data, openDialog, setBillStatus } = useApp();
  const bs = bills(data, project.id).filter((b) => b.status !== "Draft");
  const sum = (f: (b: Bill) => boolean) => bs.filter(f).reduce((a, b) => a + billTotals(b).net, 0);

  return (
    <div>
      <div className="mb-[22px]">
        <h1 className="text-[26px] font-bold tracking-tight">Bills</h1>
        <p className="mt-1 text-muted-foreground text-[13.5px]">Running account bills from Apex Studios. Amounts include GST.</p>
      </div>

      <StatBar
        stats={[
          { label: "Bills Raised", value: fmtS(sum(() => true)), sub: `${bs.length} bills` },
          { label: "Awaiting Approval", value: fmtS(sum((b) => b.status === "Submitted")), sub: `${bs.filter((b) => b.status === "Submitted").length} bills` },
          { label: "Approved, Unpaid", value: fmtS(sum((b) => b.status === "Certified")), sub: `${bs.filter((b) => b.status === "Certified").length} bills` },
          { label: "Paid", value: fmtS(sum((b) => b.status === "Paid")), sub: `${bs.filter((b) => b.status === "Paid").length} bills` },
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
            {bs.length ? (
              bs.map((b) => {
                const t = billTotals(b);
                const pk = [...new Set(b.lines.map((l) => l.mod))]
                  .map((id) => {
                    const m = project.modules.find((x) => x.id === id);
                    return m ? `${mno(project, m)} ${m.name}` : "";
                  })
                  .join(", ");
                return (
                  <tr key={b.id}>
                    <td className={td}>
                      {b.id}
                      <span className={sub}>
                        {b.paid ? `Paid ${dmy(b.paid)}` : b.certified ? `Approved ${dmy(b.certified)}` : `Submitted ${dmy(b.submitted)}`}
                      </span>
                      <BillFiles files={b.files} />
                    </td>
                    <td className={td}>{dmy(b.date)}</td>
                    <td className={td + " text-muted-foreground"}>{pk}</td>
                    <td className={tdNum}>{fmt(t.taxable)}</td>
                    <td className={tdNum}>{fmt(t.gst)}</td>
                    <td className={tdNum}>{fmt(t.net)}</td>
                    <td className={td}>
                      <BillStatusBadge status={b.status} />
                    </td>
                    <td className={td}>
                      <div className="flex gap-1.5 flex-wrap justify-end">
                        <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: "billView", billId: b.id })}>
                          View
                        </Button>
                        {b.status === "Submitted" && (
                          <Button variant="primary" size="sm" onClick={() => setBillStatus(b.id, "Certified")}>
                            Approve
                          </Button>
                        )}
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
