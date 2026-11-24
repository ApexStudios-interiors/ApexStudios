"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { formatQty } from "@/lib/quantity";
import type { InventoryItemDTO } from "@/features/inventory/queries";
import { setReorderLevel } from "@/features/inventory/actions";
import { inventoryStatus } from "@/features/inventory/service";
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
import { StockLevelBadge } from "@/components/shared/StatusBadges";

/**
 * APX-15: Minimum stock had no way to be set, so every item sat at 0 and Low
 * never fired. rpc_set_inventory_reorder_level (admin, audited). The badge
 * previews what the item will read as, by the same rule the views apply.
 */
export function MinimumStockDialog({
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
  const [level, setLevel] = useState(String(item.reorderLevel));
  const [fieldError, setFieldError] = useState<string | null>(null);

  const save = useAction(setReorderLevel, {
    onSuccess: () => {
      onOpenChange(false);
      toast(`Minimum stock saved for ${item.name}`);
      router.refresh();
    },
    onError: () => router.refresh(),
  });

  const parsed = level.trim() === "" ? Number.NaN : Number(level);
  const valid = Number.isFinite(parsed) && parsed >= 0;

  function submit() {
    if (!valid) {
      setFieldError("Enter a minimum of 0 or more.");
      return;
    }
    setFieldError(null);
    save.execute({ itemId: item.id, reorderLevel: parsed });
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
          <DialogTitle>Minimum stock — {item.name}</DialogTitle>
          <DialogDescription>
            Below this the item reads Low; at zero it is Critical. On hand now: {formatQty(item.qtyOnHand)}{" "}
            {item.unit}.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={`Minimum stock (${item.unit})`} htmlFor={`min-${item.id}`}>
            <input
              id={`min-${item.id}`}
              type="number"
              step="any"
              min={0}
              inputMode="decimal"
              className={inputClass}
              value={level}
              autoFocus
              aria-invalid={fieldError ? true : undefined}
              onChange={(e) => setLevel(e.target.value)}
            />
          </Field>
          {fieldError ? (
            <p className="text-xs text-destructive mt-1">{fieldError}</p>
          ) : (
            valid && (
              <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
                Will read <StockLevelBadge status={inventoryStatus(item.qtyOnHand, parsed)} />
              </p>
            )
          )}
          {save.result.serverError && (
            <p className="text-[12.5px] text-destructive mt-2">{save.result.serverError}</p>
          )}
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="default" disabled={save.isPending} />}>Cancel</DialogClose>
          <Button variant="primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
