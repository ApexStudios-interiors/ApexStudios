"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { formatQty } from "@/lib/quantity";
import type { StockRequestDTO } from "@/features/stock/queries";
import { transitionStockRequest } from "@/features/stock/actions";
import { splitDelivery } from "@/features/stock/service";
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
 * APX-39: Mark Delivered is confirmed, showing the quantity and unit that will
 * be added to inventory — it used to fire on a single click and fail silently.
 * APX-69: what arrived can be less than what was ordered. The remainder stays
 * Ordered as a new, linked request with its own number
 * (rpc_transition_stock_request's partial delivery) — see `splitDelivery`.
 *
 * Open to admin and site. Shows quantities only: no rate, no value.
 */
export function DeliverStockRequestDialog({
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
  const [delivered, setDelivered] = useState(String(request.qty));
  const [fieldError, setFieldError] = useState<string | null>(null);

  const parsed = delivered.trim() === "" ? Number.NaN : Number(delivered);
  const split = splitDelivery(request.qty, parsed);

  const deliver = useAction(transitionStockRequest, {
    onSuccess: () => {
      onOpenChange(false);
      toast(
        split && split.remainder > 0
          ? `${formatQty(split.delivered)} ${request.unit} delivered — ${formatQty(split.remainder)} still on order`
          : `${request.refNo} delivered`
      );
      router.refresh();
    },
    onError: () => router.refresh(),
  });

  function submit() {
    if (!split) {
      setFieldError(
        `Enter how much arrived: more than 0 and at most ${formatQty(request.qty)} ${request.unit}.`
      );
      return;
    }
    setFieldError(null);
    deliver.execute({
      requestId: request.id,
      toStatus: "delivered",
      // Only sent for a part delivery, so a full one is the call it always was.
      deliveredQty: split.remainder > 0 ? split.delivered : undefined,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!deliver.isPending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Mark {request.refNo} delivered?</DialogTitle>
          <DialogDescription>
            {request.materialName} — {formatQty(request.qty)} {request.unit} ordered. What arrives is added to
            this project&apos;s inventory.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={`Quantity delivered (${request.unit})`} htmlFor={`deliver-qty-${request.id}`}>
            <input
              id={`deliver-qty-${request.id}`}
              type="number"
              step="any"
              min={0}
              max={request.qty}
              inputMode="decimal"
              className={inputClass}
              value={delivered}
              aria-invalid={fieldError ? true : undefined}
              onChange={(e) => setDelivered(e.target.value)}
            />
          </Field>
          {fieldError ? (
            <p className="text-xs text-destructive mt-1">{fieldError}</p>
          ) : split && split.remainder > 0 ? (
            <p className="text-xs text-muted-foreground mt-1.5">
              Part delivery: {formatQty(split.remainder)} {request.unit} stays Ordered as a new request.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1.5">The full quantity.</p>
          )}
          {deliver.result.serverError && (
            <p className="text-[12.5px] text-destructive mt-2">{deliver.result.serverError}</p>
          )}
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="default" disabled={deliver.isPending} />}>Cancel</DialogClose>
          <Button variant="primary" disabled={deliver.isPending} onClick={submit}>
            {deliver.isPending ? "Saving…" : "Mark Delivered"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
