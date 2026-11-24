"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import type { Role } from "@/lib/rbac/roles";
import type { StockRequestDTO } from "@/features/stock/queries";
import { availableTransitions, canEditRequest, canSetRate } from "@/features/stock/service";
import { transitionStockRequest } from "@/features/stock/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ApproveStockRequestDialog } from "./ApproveStockRequestDialog";
import { DeliverStockRequestDialog } from "./DeliverStockRequestDialog";
import { CancelStockRequestDialog } from "./CancelStockRequestDialog";
import { EditStockRequestDialog } from "./EditStockRequestDialog";
import { SetStockRequestRateDialog } from "./SetStockRequestRateDialog";

type OpenDialog = "approve" | "deliver" | "cancel" | "edit" | "rate" | null;

/**
 * One row's actions (APX-39). Each row owns its own action hook, so a pending
 * call disables and spins only that row's button — not every button in the
 * table, as the old single shared hook did. A failed call toasts its message
 * and refreshes, so the row shows the request's real status (someone else may
 * have moved it) instead of failing silently.
 *
 * Which buttons appear is `availableTransitions` plus `canEditRequest` /
 * `canSetRate` — the same rules the RPCs enforce, never re-decided here.
 * Approve, Mark Delivered, Cancel, Edit and Set rate open a dialog; Reject
 * keeps its own (DialogHost); Mark Ordered is one click, because it changes
 * no quantity or money and is undone by nothing more than a cancel.
 */
export function StockRequestActions({ request, role }: { request: StockRequestDTO; role: Role }) {
  const router = useRouter();
  const { openDialog, toast } = useApp();
  const [open, setOpen] = useState<OpenDialog>(null);
  const isAdmin = role === "admin";

  const order = useAction(transitionStockRequest, {
    onSuccess: () => {
      toast(`${request.refNo} marked ordered`);
      router.refresh();
    },
    onError: ({ error }) => {
      toast(error.serverError ?? "Could not update this request");
      router.refresh();
    },
  });

  const transitions = availableTransitions(request.status, role, { isRequester: request.mine });
  const mayEdit = canEditRequest(request.status, role, request.mine);
  // Pending requests get their rate on Approve; this is for the steps after.
  const mayRate = canSetRate(request.status, role) && request.status !== "pending";

  if (!transitions.length && !mayEdit && !mayRate) return null;

  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };

  return (
    <div className="flex gap-1.5 flex-wrap justify-end">
      {transitions.map((t) => {
        switch (t.to) {
          case "approved":
            return (
              <Button key={t.to} variant="primary" size="sm" onClick={() => setOpen("approve")}>
                {t.label}
              </Button>
            );
          case "rejected":
            return (
              <Button
                key={t.to}
                variant="destructive"
                size="sm"
                onClick={() => openDialog({ kind: "rejectStockRequest", requestId: request.id })}
              >
                {t.label}
              </Button>
            );
          case "ordered":
            return (
              <Button
                key={t.to}
                variant="default"
                size="sm"
                disabled={order.isPending}
                onClick={() => order.execute({ requestId: request.id, toStatus: "ordered" })}
              >
                {order.isPending && <Spinner data-icon="inline-start" />}
                {t.label}
              </Button>
            );
          case "delivered":
            return (
              <Button key={t.to} variant="default" size="sm" onClick={() => setOpen("deliver")}>
                {t.label}
              </Button>
            );
          case "cancelled":
            return null; // rendered last, after Edit / Set rate
        }
      })}
      {mayEdit && (
        <Button variant="ghost" size="sm" onClick={() => setOpen("edit")}>
          Edit
        </Button>
      )}
      {mayRate && isAdmin && (
        <Button variant="ghost" size="sm" onClick={() => setOpen("rate")}>
          {request.rate == null ? "Set rate" : "Rate"}
        </Button>
      )}
      {transitions.some((t) => t.to === "cancelled") && (
        <Button variant="ghost" size="sm" onClick={() => setOpen("cancel")}>
          Cancel
        </Button>
      )}

      {open === "approve" && <ApproveStockRequestDialog request={request} open onOpenChange={close} />}
      {open === "deliver" && <DeliverStockRequestDialog request={request} open onOpenChange={close} />}
      {open === "cancel" && <CancelStockRequestDialog request={request} open onOpenChange={close} />}
      {open === "edit" && <EditStockRequestDialog request={request} open onOpenChange={close} />}
      {open === "rate" && <SetStockRequestRateDialog request={request} open onOpenChange={close} />}
    </div>
  );
}
