"use client";

import { useApp } from "@/context/AppContext";
import { Project, StockRequest } from "@/lib/types";
import { amt, canApprove, dmy, fmt, isMoney, mno } from "@/lib/logic";
import { RequestStatusBadge } from "@/components/domain/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

export function ReqTable({ project, reqs, moduleContext }: { project: Project; reqs: StockRequest[]; moduleContext?: boolean }) {
  const { role, setRequestStatus } = useApp();
  const money = isMoney(role);

  if (!reqs.length) {
    return (
      <TableWrap>
        <thead>
          <tr>
            <th className={th}>Request</th>
            <th className={th}>Material</th>
            <th className={thNum}>Qty</th>
            {money && <th className={thNum}>Value</th>}
            <th className={th}>Needed By</th>
            <th className={th}>Status</th>
            <th className={th}></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={td} colSpan={money ? 7 : 6}>
              <Empty>No requests.</Empty>
            </td>
          </tr>
        </tbody>
      </TableWrap>
    );
  }

  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>Request</th>
          <th className={th}>Material</th>
          <th className={thNum}>Qty</th>
          {money && <th className={thNum}>Value</th>}
          <th className={th}>Needed By</th>
          <th className={th}>Status</th>
          <th className={th}></th>
        </tr>
      </thead>
      <tbody>
        {reqs.map((r) => {
          const m = project.modules.find((x) => x.id === r.mod);
          const k = m?.packages.find((x) => x.id === r.pkg);
          let action: React.ReactNode = null;
          if (r.status === "Pending" && canApprove(role)) {
            action = (
              <div className="flex gap-1.5 flex-wrap justify-end">
                <Button variant="primary" size="sm" onClick={() => setRequestStatus(r.id, "Approved")}>
                  Approve
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setRequestStatus(r.id, "Rejected")}>
                  Reject
                </Button>
              </div>
            );
          } else if (r.status === "Approved" && role === "admin") {
            action = (
              <Button size="sm" onClick={() => setRequestStatus(r.id, "Ordered")}>
                Mark Ordered
              </Button>
            );
          } else if (r.status === "Ordered" && (role === "admin" || role === "site")) {
            action = (
              <Button size="sm" onClick={() => setRequestStatus(r.id, "Delivered")}>
                Mark Delivered
              </Button>
            );
          }
          return (
            <tr key={r.id}>
              <td className={td}>
                {r.id}
                <span className={sub}>
                  {dmy(r.raised)} · {r.by}
                </span>
              </td>
              <td className={td}>
                {r.item}
                <span className={sub}>
                  {!moduleContext && m ? `${mno(project, m)} ${m.name} · ` : ""}
                  {k ? k.name : ""}
                </span>
              </td>
              <td className={tdNum}>
                {r.qty.toLocaleString("en-IN")} {r.unit}
              </td>
              {money && <td className={tdNum}>{amt(r) ? fmt(amt(r)) : <span className="text-muted-foreground">–</span>}</td>}
              <td className={td}>{dmy(r.need)}</td>
              <td className={td}>
                <RequestStatusBadge status={r.status} />
              </td>
              <td className={td}>{action}</td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}
