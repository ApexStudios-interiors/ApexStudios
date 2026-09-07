"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { Project } from "@/lib/types";
import { billableItems, bills, billTotals, dmy, fmt, fmtS, lineCost, lineVal, mno, pct } from "@/lib/logic";
import { MAS } from "@/lib/data";
import { StatBar } from "@/components/ui/StatBar";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { BillStatusBadge } from "@/components/domain/StatusBadges";
import { BillFiles } from "@/components/domain/BillFiles";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";

export function BillingAdmin({ project }: { project: Project }) {
  const { data, openDialog, createBill, setBillStatus } = useApp();
  const [selKeysState, setSelKeysState] = useState<Set<string> | null>(null);

  const bs = bills(data, project.id);
  const items = billableItems(data, project);
  const sel = selKeysState ?? new Set(items.map((i) => i.key));

  const sum = (f: (b: (typeof bs)[number]) => boolean) => bs.filter(f).reduce((a, b) => a + billTotals(b).net, 0);
  const billed = sum((b) => b.status !== "Draft");
  const received = sum((b) => b.status === "Paid");
  const outstanding = sum((b) => b.status === "Submitted" || b.status === "Certified");

  const selItems = items.filter((i) => sel.has(i.key));
  const selVal = selItems.reduce((a, i) => a + lineVal(i), 0);
  const selCost = selItems.reduce((a, i) => a + lineCost(i), 0);
  const billableNow = items.reduce((a, i) => a + lineVal(i), 0);

  const toggle = (key: string) => {
    const next = new Set(sel);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelKeysState(next);
  };

  const handleCreate = () => {
    const id = createBill(project.id, sel);
    setSelKeysState(null);
    if (id) openDialog({ kind: "billView", billId: id });
  };

  return (
    <div>
      <div className="mb-[22px]">
        <h1 className="text-[26px] font-bold tracking-tight">Billing</h1>
        <p className="mt-1 text-muted-foreground text-[13.5px]">
          RA bills to {project.client}. All values at client price, ex GST unless shown.
        </p>
      </div>

      <StatBar
        stats={[
          { label: "Billed to Date", value: fmtS(billed), sub: `${bs.filter((b) => b.status !== "Draft").length} bills, incl. GST` },
          { label: "Received", value: fmtS(received), sub: `${bs.filter((b) => b.status === "Paid").length} paid` },
          { label: "Outstanding", value: fmtS(outstanding), sub: "Submitted or certified, not paid" },
          { label: "Billable Now", value: fmtS(billableNow), sub: `${items.length} items ready` },
        ]}
      />

      <Card className="mb-5">
        <CardHeader>
          <h3>Billable Now</h3>
          <div className="ml-auto flex gap-2 items-center">
            <span className="text-muted-foreground text-sm self-center">
              {selItems.length} selected · {fmt(selVal)} · margin {fmt(selVal - selCost)}
            </span>
            <Button variant="primary" size="sm" disabled={!selItems.length} onClick={handleCreate}>
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Create Bill
            </Button>
          </div>
        </CardHeader>
        <TableWrap>
          <thead>
            <tr>
              <th className={th} style={{ width: 36 }}></th>
              <th className={th}>Item</th>
              <th className={th}>Package</th>
              <th className={th}>Type</th>
              <th className={thNum}>Client Value</th>
              <th className={thNum}>Billable</th>
              <th className={thNum}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((i) => {
                const m = project.modules.find((x) => x.id === i.mod);
                return (
                  <tr key={i.key}>
                    <td className={td}>
                      <input type="checkbox" checked={sel.has(i.key)} onChange={() => toggle(i.key)} />
                    </td>
                    <td className={td}>{i.desc}</td>
                    <td className={td + " text-muted-foreground"}>{m ? `${mno(project, m)} ${m.name}` : ""}</td>
                    <td className={td}>
                      {i.type === "material" ? (
                        <Badge variant="outline">Material at site · {MAS}%</Badge>
                      ) : (
                        <Badge variant="outline">Milestone</Badge>
                      )}
                    </td>
                    <td className={tdNum}>{fmt(i.client)}</td>
                    <td className={tdNum}>{fmt(lineVal(i))}</td>
                    <td className={tdNum + " text-muted-foreground"}>{fmt(lineVal(i) - lineCost(i))}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className={td} colSpan={7}>
                  <Empty>Nothing billable yet. Items appear here when materials are delivered or milestones complete.</Empty>
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
            {bs.length ? (
              bs.map((b) => {
                const t = billTotals(b);
                const pk = [...new Set(b.lines.map((l) => l.mod))]
                  .map((id) => {
                    const m = project.modules.find((x) => x.id === id);
                    return m ? mno(project, m) : "";
                  })
                  .join(", ");
                let action: React.ReactNode = null;
                if (b.status === "Draft")
                  action = (
                    <Button variant="primary" size="sm" onClick={() => setBillStatus(b.id, "Submitted")}>
                      Submit
                    </Button>
                  );
                else if (b.status === "Submitted")
                  action = (
                    <Button size="sm" onClick={() => setBillStatus(b.id, "Certified")}>
                      Mark Certified
                    </Button>
                  );
                else if (b.status === "Certified")
                  action = (
                    <Button size="sm" onClick={() => setBillStatus(b.id, "Paid")}>
                      Mark Paid
                    </Button>
                  );
                return (
                  <tr key={b.id}>
                    <td className={td}>
                      {b.id}
                      <span className={sub}>
                        {b.paid ? `Paid ${dmy(b.paid)}` : b.certified ? `Certified ${dmy(b.certified)}` : b.submitted ? `Submitted ${dmy(b.submitted)}` : "Draft"}
                      </span>
                      <BillFiles files={b.files} />
                    </td>
                    <td className={td}>{dmy(b.date)}</td>
                    <td className={td + " text-muted-foreground"}>{pk}</td>
                    <td className={tdNum}>{fmt(t.taxable)}</td>
                    <td className={tdNum}>{fmt(t.net)}</td>
                    <td className={tdNum + " text-muted-foreground"}>
                      {fmt(t.margin)} <span className="text-xs">({pct(t.margin, t.taxable)}%)</span>
                    </td>
                    <td className={td}>
                      <BillStatusBadge status={b.status} />
                    </td>
                    <td className={td}>
                      <div className="flex gap-1.5 flex-wrap justify-end">
                        <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: "billView", billId: b.id })}>
                          View
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: "billUpload", billId: b.id })}>
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
