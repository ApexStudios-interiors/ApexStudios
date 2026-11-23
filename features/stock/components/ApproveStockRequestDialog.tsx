"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import type { StockRequestDTO } from "@/features/stock/queries";
import { transitionStockRequest } from "@/features/stock/actions";
import { formatINR } from "@/lib/money";
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
import { Field, inputClass } from "@/components/ui/DialogShell";

/**
 * APX-14: Approve asks for the negotiated rate. A request raised by Site on a
 * project whose rate is hidden (the default) has none, and used to be approved,
 * ordered, delivered and billed at ₹0. rpc_transition_stock_request refuses to
 * approve a rate-less request without one (RATE_REQUIRED), and accepts a rate
 * only from an admin, only on approval. A request that already carries a rate
 * shows it prefilled; changing it here replaces it.
 *
 * Admin only — the caller renders this for an admin row action, and the RPC is
 * the boundary regardless. The value shown is computed here from what the
 * admin types; nothing about it reaches a site session.
 */
export function ApproveStockRequestDialog({
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
  const [rate, setRate] = useState(request.rate != null ? String(request.rate) : "");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const approve = useAction(transitionStockRequest, {
    onSuccess: () => {
      onOpenChange(false);
      toast(`${request.refNo} approved`);
      router.refresh();
    },
    // The row may have moved on under us (another admin): refresh so the
    // table shows where it really is; the message stays in the dialog.
    onError: () => router.refresh(),
  });

  const parsed = rate.trim() === "" ? null : Number(rate);
  const value = parsed != null && Number.isFinite(parsed) && parsed >= 0 ? parsed * request.qty : null;

  function submit() {
    if (parsed == null || !Number.isFinite(parsed)) {
      setFieldError("Enter the rate per unit — 0 if it is free issue.");
      return;
    }
    if (parsed < 0) {
      setFieldError("Rate cannot be negative.");
      return;
    }
    setFieldError(null);
    approve.execute({ requestId: request.id, toStatus: "approved", rate: parsed });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!approve.isPending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Approve {request.refNo}?</DialogTitle>
          <DialogDescription>
            {request.materialName} — {request.qty.toLocaleString("en-IN")} {request.unit}
            {request.packageName ? ` · ${request.packageName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Rate (₹ per unit)" htmlFor={`approve-rate-${request.id}`}>
            <input
              id={`approve-rate-${request.id}`}
              type="number"
              step="any"
              min={0}
              inputMode="decimal"
              className={inputClass}
              placeholder="Negotiated rate"
              value={rate}
              autoFocus
              aria-invalid={fieldError ? true : undefined}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
          {fieldError ? (
            <p className="text-xs text-destructive mt-1">{fieldError}</p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1.5">
              {value != null ? `Commits ${formatINR(value)} to this package's budget.` : "Required to approve."}
            </p>
          )}
          {approve.result.serverError && (
            <p className="text-[12.5px] text-destructive mt-2">{approve.result.serverError}</p>
          )}
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="default" disabled={approve.isPending} />}>Cancel</DialogClose>
          <Button variant="primary" disabled={approve.isPending} onClick={submit}>
            {approve.isPending ? "Approving…" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
