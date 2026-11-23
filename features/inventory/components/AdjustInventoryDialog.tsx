"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import type { InventoryItemDTO } from "@/features/inventory/queries";
import { adjustInventory } from "@/features/inventory/actions";
import { adjustInventorySchema } from "@/features/inventory/schema";
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

/**
 * APX-15: the web's Adjust — until now only the mobile API could correct
 * stock. Sets the NEW quantity on hand after a physical count, with a required
 * reason; rpc_adjust_inventory works out the difference, writes it to the
 * stock ledger as an in or out movement with the reason, and audits it. It is
 * also how an opening balance is entered (APX-34: a new item starts at 0).
 * Admin only.
 */
export function AdjustInventoryDialog({
  item,
  open,
  onOpenChange,
}: {
  item: InventoryItemDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useApp();
  const [newQty, setNewQty] = useState(String(item.qtyOnHand));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ newQty?: string; reason?: string }>({});

  const adjust = useAction(adjustInventory, {
    onSuccess: () => {
      onOpenChange(false);
      toast(`${item.name} adjusted`);
      router.refresh();
    },
    onError: () => router.refresh(),
  });

  function submit() {
    const parsed = adjustInventorySchema.safeParse({ itemId: item.id, newQty, reason });
    if (!parsed.success || newQty.trim() === "") {
      const issue = (key: string) => parsed.error?.issues.find((i) => i.path[0] === key)?.message;
      setErrors({
        newQty: newQty.trim() === "" ? "Enter the quantity counted" : issue("newQty"),
        reason: issue("reason"),
      });
      return;
    }
    setErrors({});
    adjust.execute(parsed.data);
  }

  const parsedQty = Number(newQty);
  const delta = newQty.trim() !== "" && Number.isFinite(parsedQty) ? parsedQty - item.qtyOnHand : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!adjust.isPending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Adjust {item.name}</DialogTitle>
          <DialogDescription>
            On hand now: {item.qtyOnHand.toLocaleString("en-IN")} {item.unit}. Enter what was actually counted; the
            difference is recorded in the stock ledger with your reason.
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
            <Field label={`New quantity on hand (${item.unit})`} htmlFor={`adjust-qty-${item.id}`}>
              <input
                id={`adjust-qty-${item.id}`}
                type="number"
                step="any"
                min={0}
                inputMode="decimal"
                className={inputClass}
                value={newQty}
                autoFocus
                aria-invalid={errors.newQty ? true : undefined}
                onChange={(e) => setNewQty(e.target.value)}
              />
            </Field>
            {errors.newQty ? (
              <p className="text-xs text-destructive mt-1">{errors.newQty}</p>
            ) : (
              delta != null &&
              delta !== 0 && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  {delta > 0 ? "+" : "−"}
                  {Math.abs(delta).toLocaleString("en-IN", { maximumFractionDigits: 3 })} {item.unit}
                </p>
              )
            )}
          </div>
          <div>
            <Field label="Reason" htmlFor={`adjust-reason-${item.id}`}>
              <textarea
                id={`adjust-reason-${item.id}`}
                className={textareaClass}
                placeholder="Physical count, damaged, opening balance…"
                value={reason}
                aria-invalid={errors.reason ? true : undefined}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {errors.reason && <p className="text-xs text-destructive mt-1">{errors.reason}</p>}
          </div>
          {adjust.result.serverError && (
            <p className="text-[12.5px] text-destructive">{adjust.result.serverError}</p>
          )}
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="default" disabled={adjust.isPending} />}>Cancel</DialogClose>
          <Button variant="primary" disabled={adjust.isPending} onClick={submit}>
            {adjust.isPending ? "Saving…" : "Adjust"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
