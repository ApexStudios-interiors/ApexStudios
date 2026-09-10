"use client";

import { useApp } from "@/context/AppContext";
import type { Approval, Project } from "@/lib/types";
import { dmy, isClientRole, mno } from "@/lib/logic";
import { ApprovalStatusBadge } from "@/components/domain/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, th, sub } from "@/components/ui/table";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";

export function ApprovalTable({ project, list }: { project: Project; list: Approval[] }) {
  const { role, setApprovalStatus, openDialog } = useApp();
  const client = isClientRole(role);

  if (!list.length) {
    return (
      <TableWrap>
        <thead>
          <tr>
            <th className={th}>Ref</th>
            <th className={th}>Item</th>
            <th className={th}>Type</th>
            <th className={th}>Requested</th>
            <th className={th}>Needed By</th>
            <th className={th}>Status</th>
            <th className={th}></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={td} colSpan={7}>
              <Empty>Nothing here.</Empty>
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
          <th className={th}>Ref</th>
          <th className={th}>Item</th>
          <th className={th}>Type</th>
          <th className={th}>Requested</th>
          <th className={th}>Needed By</th>
          <th className={th}>Status</th>
          <th className={th}></th>
        </tr>
      </thead>
      <tbody>
        {list.map((a) => {
          const m = project.modules.find((x) => x.id === a.mod);
          const k = m?.packages.find((x) => x.id === a.pkg);
          const action =
            a.status === "Pending" && client ? (
              <div className="flex gap-1.5 flex-wrap justify-end">
                <Button variant="primary" size="sm" onClick={() => setApprovalStatus(a.id, "Approved")}>
                  Approve
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setApprovalStatus(a.id, "Rejected")}>
                  Reject
                </Button>
              </div>
            ) : !client ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openDialog({ kind: "approvalPhotos", approvalId: a.id })}
              >
                Add photos
              </Button>
            ) : null;
          const photoCount = Math.min(a.photos, 4);
          return (
            <tr key={a.id}>
              <td className={td}>
                {a.id}
                <span className={sub}>{a.by}</span>
              </td>
              <td className={td}>
                {a.item}
                <span className={sub}>
                  {m ? `${mno(project, m)} ${m.name}` : ""}
                  {k ? ` · ${k.name}` : ""}
                  {a.note ? ` · ${a.note}` : ""}
                </span>
                {a.photos ? (
                  <div className="flex gap-1.5 mt-2 items-center">
                    {Array.from({ length: photoCount }, (_, i) => (
                      <i key={i} className="w-14 h-[42px] rounded bg-muted border border-border not-italic" />
                    ))}
                    {a.photos > 4 && <span className="text-xs text-muted-foreground">+{a.photos - 4}</span>}
                  </div>
                ) : null}
              </td>
              <td className={td}>
                <Badge variant="outline">{a.type}</Badge>
              </td>
              <td className={td}>{dmy(a.requested)}</td>
              <td className={td}>{dmy(a.need)}</td>
              <td className={td}>
                <ApprovalStatusBadge status={a.status} />
                {a.decided && <span className={sub + " text-xs"}>{dmy(a.decided)}</span>}
              </td>
              <td className={td}>{action}</td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}
