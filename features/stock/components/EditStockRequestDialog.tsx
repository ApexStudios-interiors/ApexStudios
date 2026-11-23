"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import type { StockRequestDTO } from "@/features/stock/queries";
import { editStockRequest } from "@/features/stock/actions";
import { editStockRequestSchema } from "@/features/stock/schema";
import { todayIst } from "@/lib/dates";
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
import { Field, inputClass, textareaClass } from "@/components/ui/DialogShell";
import { DatePicker } from "@/components/shared/DatePicker";

/**
 * APX-42: fix a pending request — a typo of 1000 for 100 bags no longer has to
 * be rejected and re-raised under a new number. Quantity, Needed By and Note
 * only; the material, unit and package define WHAT is being asked for, and a
 * different one is a different request. rpc_edit_stock_request allows it to
 * the requester or an admin while pending, and audits the before and after.
 */
export function EditStockRequestDialog({
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
  const [qty, setQty] = useState(String(request.qty));
  const [neededBy, setNeededBy] = useState(request.neededBy ?? "");
  const [note, setNote] = useState(request.note ?? "");
  const [errors, setErrors] = useState<{ qty?: string; neededBy?: string }>({});

  const edit = useAction(editStockRequest, {
    onSuccess: () => {
      onOpenChange(false);
      toast(`${request.refNo} updated`);
      router.refresh();
    },
    onError: () => router.refresh(),
  });

  function submit() {
    const parsed = editStockRequestSchema.safeParse({ requestId: request.id, qty, neededBy, note });
    if (!parsed.success) {
      const issue = (key: string) => parsed.error.issues.find((i) => i.path[0] === key)?.message;
      setErrors({ qty: issue("qty"), neededBy: issue("neededBy") });
      return;
    }
    // A date being changed must not be in the past; an unchanged one may be
    // kept even once it has passed (the RPC applies the same rule).
    if (parsed.data.neededBy && parsed.data.neededBy !== request.neededBy && parsed.data.neededBy < todayIst()) {
      setErrors({ neededBy: "Needed-by date cannot be in the past" });
      return;
    }
    setErrors({});
    edit.execute(parsed.data);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!edit.isPending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Edit {request.refNo}</DialogTitle>
          <DialogDescription>
            {request.materialName}
            {request.packageName ? ` · ${request.packageName}` : ""}. Only a pending request can be edited.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <Field label={`Quantity (${request.unit})`} htmlFor={`edit-qty-${request.id}`}>
              <input
                id={`edit-qty-${request.id}`}
                type="number"
                step="any"
                min={0}
                inputMode="decimal"
                className={inputClass}
                value={qty}
                aria-invalid={errors.qty ? true : undefined}
                onChange={(e) => setQty(e.target.value)}
              />
            </Field>
            {errors.qty && <p className="text-xs text-destructive mt-1">{errors.qty}</p>}
          </div>
          <div>
            <Field label="Needed By" htmlFor={`edit-needed-${request.id}`}>
              <DatePicker
                id={`edit-needed-${request.id}`}
                value={neededBy}
                onChange={setNeededBy}
                minDate={todayIst()}
              />
            </Field>
            {errors.neededBy && <p className="text-xs text-destructive mt-1">{errors.neededBy}</p>}
          </div>
          <Field label="Note" htmlFor={`edit-note-${request.id}`}>
            <textarea
              id={`edit-note-${request.id}`}
              className={textareaClass}
              placeholder="Optional"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {edit.result.serverError && (
            <p className="text-[12.5px] text-destructive">{edit.result.serverError}</p>
          )}
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="default" disabled={edit.isPending} />}>Cancel</DialogClose>
          <Button variant="primary" disabled={edit.isPending} onClick={submit}>
            {edit.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
