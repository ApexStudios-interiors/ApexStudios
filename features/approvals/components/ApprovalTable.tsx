"use client";

import { useState, type ReactNode } from "react";
import { useApp } from "@/context/AppContext";
import type { Role } from "@/lib/rbac/roles";
import { can } from "@/lib/rbac/permissions";
import type { ApprovalDTO } from "@/features/approvals/queries";
import { dmy } from "@/lib/format";
import { ApprovalStatusBadge, ApprovalTypeBadge } from "@/components/shared/StatusBadges";
import { DisabledReason } from "@/components/shared/DisabledReason";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, th, sub } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/DialogShell";
import { Empty } from "@/components/ui/Empty";
import { WithdrawApprovalButton } from "./WithdrawApprovalButton";

/** Shown on the focusable wrapper of a decided row's disabled "Add photos". */
const ADD_PHOTOS_CLOSED = "Photos can only be added while the approval is pending.";

/**
 * build/08-approvals.md §2.5. Real DTOs, not `useApp()` data — the mock's
 * `photos: number` placeholder grid becomes real thumbnails with a lightbox
 * (`UpdateList.tsx`'s own established pattern, build §2.5 step 8: "a client
 * deciding on a marble sample needs to see it at full size, on a phone").
 * Per-row actions are driven by `can(role, 'decideApproval'/'requestApproval')`
 * plus the row's own status (`canDecide`/`canAddPhotos`/`canSupersede` on the
 * DTO, `features/approvals/service.ts`) — never a role string inline here.
 *
 * APX-16: below `md` the rows render as a card list — a client deciding on a
 * phone gets the item, its photos and Approve/Reject without scrolling a
 * 680px table sideways. From `md` up it is the table it always was.
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

  const head = (
    <thead>
      <tr>
        <th className={th}>Ref</th>
        <th className={th}>Item</th>
        <th className={th}>Type</th>
        <th className={th}>Requested</th>
        <th className={th}>Needed By</th>
        <th className={th}>Status</th>
        <th className={th}>
          <span className="sr-only">Actions</span>
        </th>
      </tr>
    </thead>
  );

  if (!list.length) {
    return (
      <>
        <div className="md:hidden">
          <Empty>Nothing here.</Empty>
        </div>
        <div className="max-md:hidden">
          <TableWrap>
            {head}
            <tbody>
              <tr>
                <td className={td} colSpan={7}>
                  <Empty>Nothing here.</Empty>
                </td>
              </tr>
            </tbody>
          </TableWrap>
        </div>
      </>
    );
  }

  const actionFor = (a: ApprovalDTO): ReactNode => {
    if (mayDecide && a.canDecide) {
      return (
        <div className="flex gap-1.5 flex-wrap justify-end">
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              openDialog({ kind: "decideApproval", approvalId: a.id, decision: "approved", item: a.item })
            }
          >
            Approve
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() =>
              openDialog({ kind: "decideApproval", approvalId: a.id, decision: "rejected", item: a.item })
            }
          >
            Reject
          </Button>
        </div>
      );
    }
    if (mayRequest && a.canSupersede) {
      // build §2.3: "Raise revised approval" — a new request pre-filled
      // from this one, with `supersedesId` set.
      return (
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
    }
    if (mayAddPhotos) {
      return (
        <div className="flex gap-1.5 flex-wrap justify-end">
          <DisabledReason reason={a.canAddPhotos ? null : ADD_PHOTOS_CLOSED}>
            <Button
              variant="ghost"
              size="sm"
              disabled={!a.canAddPhotos}
              onClick={() =>
                openDialog({
                  kind: "approvalPhotos",
                  approvalId: a.id,
                  projectId,
                  item: a.item,
                  // APX-46: the uploader offers only the slots left.
                  existingPhotos: a.attachments.length,
                })
              }
            >
              Add photos
            </Button>
          </DisabledReason>
          {/* APX-42: the requester's own pending approval. */}
          {a.canWithdraw && <WithdrawApprovalButton approvalId={a.id} refNo={a.refNo} item={a.item} />}
        </div>
      );
    }
    return null;
  };

  const detailFor = (a: ApprovalDTO) => (
    <>
      <span className={sub}>
        {a.packageName
          ? `${a.packageSeqNo != null ? String(a.packageSeqNo).padStart(2, "0") + " " : ""}${a.packageName}`
          : ""}
        {a.phaseName ? ` · ${a.phaseName}` : ""}
        {a.note ? ` · ${a.note}` : ""}
      </span>
      {a.supersedesRefNo && <span className={sub}>Revises {a.supersedesRefNo}</span>}
      {a.supersededByRefNo && <span className={sub}>Superseded by {a.supersededByRefNo}</span>}
    </>
  );

  const photosFor = (a: ApprovalDTO) => {
    const photos = a.attachments.slice(0, 4);
    const extra = a.attachments.length - photos.length;
    if (!photos.length) return null;
    return (
      <div className="flex gap-1.5 mt-2 items-center">
        {photos.map((p, i) =>
          p.isImage && p.thumbUrl ? (
            <button
              key={p.id}
              type="button"
              onClick={() => setLightbox({ url: p.downloadUrl, alt: a.item })}
              aria-label={`View photo ${i + 1} of ${a.attachments.length}: ${a.item}`}
              className="w-14 h-[42px] rounded overflow-hidden border border-border shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL, not an optimisable next/image source */}
              <img src={p.thumbUrl} alt="" className="w-full h-full object-cover" />
            </button>
          ) : (
            <a
              key={p.id}
              href={p.downloadUrl}
              aria-label={`Download file ${i + 1} of ${a.attachments.length}: ${a.item}`}
              className="w-14 h-[42px] rounded bg-muted border border-border shrink-0 flex items-center justify-center text-[10px] text-muted-foreground underline"
            >
              File
            </a>
          )
        )}
        {extra > 0 && (
          <span className="text-xs text-muted-foreground">
            +{extra}
            <span className="sr-only"> more</span>
          </span>
        )}
      </div>
    );
  };

  const decisionFor = (a: ApprovalDTO) => (
    <>
      {a.decidedAt && <span className={sub + " text-xs"}>{dmy(a.decidedAt.slice(0, 10))}</span>}
      {a.status === "rejected" && a.decisionReason && (
        <span className={sub + " text-xs"}>{a.decisionReason}</span>
      )}
    </>
  );

  return (
    <>
      {/* Phone: one card per approval. */}
      <ul className="md:hidden divide-y divide-border" aria-label="Approvals">
        {list.map((a) => {
          const action = actionFor(a);
          return (
            <li key={a.id} className="px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium">{a.item}</div>
                  {detailFor(a)}
                </div>
                <ApprovalStatusBadge status={a.status} />
              </div>
              {photosFor(a)}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <ApprovalTypeBadge type={a.type} />
                <span className="whitespace-nowrap">{a.refNo}</span>
                <span className="whitespace-nowrap">Requested {dmy(a.requestedAt.slice(0, 10))}</span>
                {a.neededBy && <span className="whitespace-nowrap">Needed by {dmy(a.neededBy)}</span>}
                <span>{a.requestedByName}</span>
              </div>
              {decisionFor(a)}
              {action && <div className="mt-2.5 flex justify-end">{action}</div>}
            </li>
          );
        })}
      </ul>

      {/* md and up: the table. */}
      <div className="max-md:hidden">
        <TableWrap>
          {head}
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td className={td}>
                  <span className="whitespace-nowrap">{a.refNo}</span>
                  <span className={sub}>{a.requestedByName}</span>
                </td>
                <td className={td}>
                  {a.item}
                  {detailFor(a)}
                  {photosFor(a)}
                </td>
                <td className={td}>
                  <ApprovalTypeBadge type={a.type} />
                </td>
                <td className={`${td} whitespace-nowrap`}>{dmy(a.requestedAt.slice(0, 10))}</td>
                <td className={`${td} whitespace-nowrap`}>{a.neededBy ? dmy(a.neededBy) : "—"}</td>
                <td className={td}>
                  <ApprovalStatusBadge status={a.status} />
                  {decisionFor(a)}
                </td>
                <td className={td}>{actionFor(a)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

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
