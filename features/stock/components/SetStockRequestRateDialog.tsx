"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import type { StockRequestDTO } from "@/features/stock/queries";
import { setStockRequestRate } from "@/features/stock/actions";
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
 * APX-14: an admin sets or corrects a request's rate after approval, up to
 * delivery (rpc_set_stock_request_rate, audited with the before and after).
 * From delivery the rate is in the stock ledger and may be on a bill, so it is
 * fixed. Admin only: the button is rendered for admins and the RPC refuses
 * anyone else.
 */
export function SetStockRequestRateDialog({
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

  const save = useAction(setStockRequestRate, {
    onSuccess: () => {
      onOpenChange(false);
      toast(`Rate saved on ${request.refNo}`);
      router.refresh();
    },
    onError: () => router.refresh(),
  });

  const parsed = rate.trim() === "" ? null : Number(rate);
  const valid = parsed != null && Number.isFinite(parsed) && parsed >= 0;

  function submit() {
    if (!valid || parsed == null) {
      setFieldError("Enter a rate of 0 or more.");
      return;
    }
    setFieldError(null);
    save.execute({ requestId: request.id, rate: parsed });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!save.isPending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{request.rate == null ? "Set rate" : "Correct rate"} — {request.refNo}</DialogTitle>
          <DialogDescription>
            {request.materialName} — {request.qty.toLocaleString("en-IN")} {request.unit}. The rate is fixed once
            the material is delivered.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Rate (₹ per unit)" htmlFor={`rate-${request.id}`}>
            <input
              id={`rate-${request.id}`}
              type="number"
              step="any"
              min={0}
              inputMode="decimal"
              className={inputClass}
              value={rate}
              autoFocus
              aria-invalid={fieldError ? true : undefined}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
          {fieldError ? (
            <p className="text-xs text-destructive mt-1">{fieldError}</p>
          ) : (
            valid &&
            parsed != null && (
              <p className="text-xs text-muted-foreground mt-1.5">Value {formatINR(parsed * request.qty)}</p>
            )
          )}
          {save.result.serverError && (
            <p className="text-[12.5px] text-destructive mt-2">{save.result.serverError}</p>
          )}
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="default" disabled={save.isPending} />}>Cancel</DialogClose>
          <Button variant="primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : "Save rate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
