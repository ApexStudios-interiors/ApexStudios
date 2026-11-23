"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import type { StockRequestDTO } from "@/features/stock/queries";
import { transitionStockRequest } from "@/features/stock/actions";
import { cancelNeedsReason } from "@/features/stock/service";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, textareaClass } from "@/components/ui/DialogShell";

/**
 * APX-42: cancel a request. Its requester may withdraw it while pending (no
 * reason needed — it was their own mistake). An admin may cancel an approved
 * or ordered one, with a reason (`cancelNeedsReason`), which is kept on the
 * request and shown in the table. rpc_transition_stock_request enforces both.
 * Cancelled is final: a different order is a new request.
 */
export function CancelStockRequestDialog({
  request,
  open,
  onOpenChange,
}: {
  request: StockRequestDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useApp();
  const needsReason = cancelNeedsReason(request.status);
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const cancel = useAction(transitionStockRequest, {
    onSuccess: () => {
      onOpenChange(false);
      toast(`${request.refNo} cancelled`);
      router.refresh();
    },
    onError: () => router.refresh(),
  });

  function submit() {
    if (needsReason && !reason.trim()) {
      setFieldError("Please give a reason.");
      return;
    }
    setFieldError(null);
    cancel.execute({ requestId: request.id, toStatus: "cancelled", note: reason.trim() || undefined });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!cancel.isPending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Cancel {request.refNo}?</DialogTitle>
          <DialogDescription>
            {request.materialName} — {request.qty.toLocaleString("en-IN")} {request.unit}.{" "}
            {needsReason
              ? "It has already been approved, so it leaves the package's committed budget. This cannot be undone."
              : "It is withdrawn before anyone acts on it. This cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={needsReason ? "Reason" : "Reason (optional)"} htmlFor={`cancel-reason-${request.id}`}>
            <textarea
              id={`cancel-reason-${request.id}`}
              className={textareaClass}
              placeholder={needsReason ? "Why is this order being cancelled?" : "Optional"}
              value={reason}
              aria-invalid={fieldError ? true : undefined}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {fieldError && <p className="text-xs text-destructive mt-1">{fieldError}</p>}
          {cancel.result.serverError && (
            <p className="text-[12.5px] text-destructive mt-2">{cancel.result.serverError}</p>
          )}
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="default" disabled={cancel.isPending} />}>Keep it</DialogClose>
          <Button variant="destructive" disabled={cancel.isPending} onClick={submit}>
            {cancel.isPending ? "Cancelling…" : "Cancel request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
