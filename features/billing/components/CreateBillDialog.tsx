"use client";

import { useState } from "react";
import type { BillPreview } from "@/features/billing/service";
import { formatINR } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field } from "@/components/ui/DialogShell";
import { DatePicker } from "@/components/shared/DatePicker";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * APX-17: Create Bill asks first, and shows what it is about to create. The
 * figures are the Billable Now preview (features/billing/service.ts), which
 * reads the same view columns rpc_create_bill does (APX-30) — so what is
 * confirmed here is what the draft will carry.
 *
 * The billing period is optional (APX-22): both dates or neither. The bill's
 * own date is not chosen here — it is the day the bill is submitted, in IST.
 */
export function CreateBillDialog({
  open,
  onOpenChange,
  lineCount,
  preview,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineCount: number;
  preview: BillPreview;
  pending: boolean;
  error: string | null;
  onConfirm: (period: { periodFrom?: string; periodTo?: string }) => void;
}) {
  const [periodFrom, setPeriodFrom] = useState<string | undefined>(undefined);
  const [periodTo, setPeriodTo] = useState<string | undefined>(undefined);

  const periodError =
    (periodFrom === undefined) !== (periodTo === undefined)
      ? "Give both period dates, or neither."
      : periodFrom && periodTo && periodFrom > periodTo
        ? "The period must start on or before it ends."
        : null;

  const rows: [string, string, boolean?][] = [
    ["Work value", formatINR(preview.workValue)],
    ["Material at site", formatINR(preview.materialValue)],
    ["Gross", formatINR(preview.grossAmount), true],
    ["Less: MAS recovery", formatINR(preview.masRecoveryAmount)],
    ["Taxable value", formatINR(preview.taxableAmount), true],
    ["GST", formatINR(preview.gstAmount)],
    ["Invoice total", formatINR(preview.invoiceTotal), true],
    ["Less: retention", formatINR(preview.retentionAmount)],
    ["Less: TDS", formatINR(preview.tdsAmount)],
    ["Less: advance recovery", formatINR(preview.advanceRecovery)],
    ["Net payable", formatINR(preview.netPayable), true],
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Create a draft bill?</DialogTitle>
          <DialogDescription>
            {lineCount} item{lineCount === 1 ? "" : "s"} go on a new draft. Nothing is sent to the client
            until you submit it, and a draft can still be cancelled. The bill is dated the day it is
            submitted.
          </DialogDescription>
        </DialogHeader>

        <table className="w-full text-[13px]">
          <tbody>
            {rows.map(([label, value, strong]) => (
              <tr key={label} className={strong ? "font-semibold" : "text-muted-foreground"}>
                <td className="py-0.5">{label}</td>
                <td className="py-0.5 text-right tabular-nums">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Period from (optional)" htmlFor="cb-period-from">
            <DatePicker id="cb-period-from" value={periodFrom} onChange={setPeriodFrom} disabled={pending} />
          </Field>
          <Field label="Period to (optional)" htmlFor="cb-period-to">
            <DatePicker
              id="cb-period-to"
              value={periodTo}
              onChange={setPeriodTo}
              minDate={periodFrom}
              disabled={pending}
            />
          </Field>
        </div>
        {(periodFrom || periodTo) && (
          <button
            type="button"
            className="self-start text-[12.5px] text-muted-foreground underline underline-offset-2"
            onClick={() => {
              setPeriodFrom(undefined);
              setPeriodTo(undefined);
            }}
            disabled={pending}
          >
            Clear period
          </button>
        )}

        {(periodError ?? error) && <p className="text-[12.5px] text-destructive">{periodError ?? error}</p>}

        <DialogFooter>
          <DialogClose render={<Button variant="default" disabled={pending} />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={pending || periodError !== null}
            onClick={() => onConfirm({ periodFrom, periodTo })}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {pending ? "Creating…" : `Create draft · ${formatINR(preview.netPayable)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
