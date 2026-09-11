"use client";

import { useState, type ReactNode } from "react";
import { useApp } from "@/context/AppContext";
import type { Role } from "@/lib/rbac/roles";
import { can } from "@/lib/rbac/permissions";
import type { ApprovalDTO } from "@/features/approvals/queries";
import { dmy } from "@/lib/logic";
import { ApprovalStatusBadge, ApprovalTypeBadge } from "@/components/domain/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, th, sub } from "@/components/ui/table";
import { Button } from "@/components/ui/Button";
import { DialogShell } from "@/components/ui/DialogShell";
import { Empty } from "@/components/ui/Empty";

/**
 * build/08-approvals.md §2.5. Real DTOs, not `useApp()` data — the mock's
 * `photos: number` placeholder grid becomes real thumbnails with a lightbox
 * (`UpdateList.tsx`'s own established pattern, build §2.5 step 8: "a client
 * deciding on a marble sample needs to see it at full size, on a phone").
 * Per-row actions are driven by `can(role, 'decideApproval'/'requestApproval')`
 * plus the row's own status (`canDecide`/`canAddPhotos`/`canSupersede` on the
 * DTO, `features/approvals/service.ts`) — never a role string inline here.
 */
export function ApprovalTable({
  projectId,
  list,
  role,
}: {
  projectId: string;
  list: ApprovalDTO[];
  role: Role;
}) {
  const { openDialog } = useApp();
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
  const mayDecide = can(role, "decideApproval");
  const mayAddPhotos = can(role, "addSamplePhotos");
  const mayRequest = can(role, "requestApproval");

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
    <>
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
            const photos = a.attachments.slice(0, 4);
            const extra = a.attachments.length - photos.length;

            let action: ReactNode = null;
            if (mayDecide && a.canDecide) {
              action = (
                <div className="flex gap-1.5 flex-wrap justify-end">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      openDialog({
                        kind: "decideApproval",
                        approvalId: a.id,
                        decision: "approved",
                        item: a.item,
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      openDialog({
                        kind: "decideApproval",
                        approvalId: a.id,
                        decision: "rejected",
                        item: a.item,
                      })
                    }
                  >
                    Reject
                  </Button>
                </div>
              );
            } else if (mayRequest && a.canSupersede) {
              // build §2.3: "Raise revised approval" — a new request pre-filled
              // from this one, with `supersedesId` set.
              action = (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    openDialog({
                      kind: "newApproval",
                      projectId,
                      supersedes: {
                        id: a.id,
                        packageId: a.packageId,
                        phaseId: a.phaseId,
                        type: a.type,
                        item: a.item,
                      },
                    })
                  }
                >
                  Raise revised approval
                </Button>
              );
            } else if (mayAddPhotos) {
              action = (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!a.canAddPhotos}
                  onClick={() =>
                    openDialog({ kind: "approvalPhotos", approvalId: a.id, projectId, item: a.item })
                  }
                >
                  Add photos
                </Button>
              );
            }

            return (
              <tr key={a.id}>
                <td className={td}>
                  {a.refNo}
                  <span className={sub}>{a.requestedByName}</span>
                </td>
                <td className={td}>
                  {a.item}
                  <span className={sub}>
                    {a.packageName
                      ? `${a.packageSeqNo != null ? String(a.packageSeqNo).padStart(2, "0") + " " : ""}${a.packageName}`
                      : ""}
                    {a.phaseName ? ` · ${a.phaseName}` : ""}
                    {a.note ? ` · ${a.note}` : ""}
                  </span>
                  {a.supersedesRefNo && <span className={sub}>Revises {a.supersedesRefNo}</span>}
                  {a.supersededByRefNo && <span className={sub}>Superseded by {a.supersededByRefNo}</span>}
                  {photos.length > 0 && (
                    <div className="flex gap-1.5 mt-2 items-center">
                      {photos.map((p) =>
                        p.isImage && p.thumbUrl ? (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setLightbox({ url: p.downloadUrl, alt: a.item })}
                            className="w-14 h-[42px] rounded overflow-hidden border border-border shrink-0"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL, not an optimisable next/image source */}
                            <img src={p.thumbUrl} alt="" className="w-full h-full object-cover" />
                          </button>
                        ) : (
                          <a
                            key={p.id}
                            href={p.downloadUrl}
                            className="w-14 h-[42px] rounded bg-muted border border-border shrink-0 flex items-center justify-center text-[10px] text-muted-foreground underline"
                          >
                            File
                          </a>
                        )
                      )}
                      {extra > 0 && <span className="text-xs text-muted-foreground">+{extra}</span>}
                    </div>
                  )}
                </td>
                <td className={td}>
                  <ApprovalTypeBadge type={a.type} />
                </td>
                <td className={td}>{dmy(a.requestedAt.slice(0, 10))}</td>
                <td className={td}>{a.neededBy ? dmy(a.neededBy) : "—"}</td>
                <td className={td}>
                  <ApprovalStatusBadge status={a.status} />
                  {a.decidedAt && <span className={sub + " text-xs"}>{dmy(a.decidedAt.slice(0, 10))}</span>}
                  {a.status === "rejected" && a.decisionReason && (
                    <span className={sub + " text-xs"}>{a.decisionReason}</span>
                  )}
                </td>
                <td className={td}>{action}</td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>

      {lightbox && (
        <DialogShell
          title="Photo"
          okLabel="Close"
          onOk={() => setLightbox(null)}
          onClose={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- see the grid's own comment above */}
          <img src={lightbox.url} alt={lightbox.alt} className="max-w-full max-h-[70vh] mx-auto rounded-md" />
        </DialogShell>
      )}
    </>
  );
}
