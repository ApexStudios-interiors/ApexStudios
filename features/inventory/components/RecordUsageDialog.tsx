"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { formatQty } from "@/lib/quantity";
import type { InventoryItemDTO } from "@/features/inventory/queries";
import { recordStockUsage } from "@/features/inventory/actions";
import { recordUsageSchema } from "@/features/inventory/schema";
import { getPackageOptions } from "@/features/stock/actions";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * APX-69: Record usage. Inventory used to only ever go up, so on-hand figures
 * drifted into fiction and Low never fired. A supervisor records what was
 * used, on which package; rpc_record_stock_usage writes an 'out' movement,
 * never more than is on hand (NEGATIVE_STOCK), under the item's row lock, and
 * audits it. Quantities only — nothing here shows or sends money.
 *
 * Only offered for a project's own stock (`item.projectId`); central-store
 * stock is issued to a project by an admin Adjust.
 */
export function RecordUsageDialog({
  item,
  projectId,
  open,
  onOpenChange,
}: {
  item: InventoryItemDTO;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useApp();
  const [packages, setPackages] = useState<{ id: string; name: string }[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ packageId?: string; qty?: string }>({});

  useEffect(() => {
    let cancelled = false;
    getPackageOptions(projectId)
      .then((opts) => {
        if (!cancelled) setPackages(opts);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load this project's packages.");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const record = useAction(recordStockUsage, {
    onSuccess: ({ data }) => {
      onOpenChange(false);
      toast(`Usage recorded — ${data ? formatQty(data.qtyOnHand) : ""} ${item.unit} of ${item.name} left`);
      router.refresh();
    },
    onError: () => router.refresh(),
  });

  function submit() {
    const parsed = recordUsageSchema.safeParse({ itemId: item.id, packageId: packageId ?? "", qty, note });
    if (!parsed.success) {
      const issue = (key: string) => parsed.error.issues.find((i) => i.path[0] === key)?.message;
      setErrors({ packageId: packageId ? undefined : "Select a package", qty: issue("qty") });
      return;
    }
    if (parsed.data.qty > item.qtyOnHand) {
      setErrors({ qty: `Only ${formatQty(item.qtyOnHand)} ${item.unit} on hand.` });
      return;
    }
    setErrors({});
    record.execute(parsed.data);
  }

  const packageItems = (packages ?? []).map((p) => ({ value: p.id, label: p.name }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!record.isPending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Record usage — {item.name}</DialogTitle>
          <DialogDescription>
            On hand: {formatQty(item.qtyOnHand)} {item.unit}. What was used comes off the stock.
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
            <Field label="Used on package" htmlFor={`usage-pkg-${item.id}`}>
              <Select
                items={packageItems}
                disabled={!packages}
                value={packages ? packageId : null}
                onValueChange={(v) => setPackageId(v)}
              >
                <SelectTrigger
                  id={`usage-pkg-${item.id}`}
                  className="h-9 w-full text-[13.5px]"
                  aria-invalid={errors.packageId ? true : undefined}
                >
                  <SelectValue placeholder={packages ? "Select a package" : (loadError ?? "Loading…")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {packageItems.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {(errors.packageId ?? loadError) && (
              <p className="text-xs text-destructive mt-1">{errors.packageId ?? loadError}</p>
            )}
          </div>
          <div>
            <Field label={`Quantity used (${item.unit})`} htmlFor={`usage-qty-${item.id}`}>
              <input
                id={`usage-qty-${item.id}`}
                type="number"
                step="any"
                min={0}
                max={item.qtyOnHand}
                inputMode="decimal"
                className={inputClass}
                placeholder="0"
                value={qty}
                aria-invalid={errors.qty ? true : undefined}
                onChange={(e) => setQty(e.target.value)}
              />
            </Field>
            {errors.qty && <p className="text-xs text-destructive mt-1">{errors.qty}</p>}
          </div>
          <Field label="Note" htmlFor={`usage-note-${item.id}`}>
            <textarea
              id={`usage-note-${item.id}`}
              className={textareaClass}
              placeholder="Optional — where or what for"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {record.result.serverError && (
            <p className="text-[12.5px] text-destructive">{record.result.serverError}</p>
          )}
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="default" disabled={record.isPending} />}>Cancel</DialogClose>
          <Button variant="primary" disabled={record.isPending || !packages} onClick={submit}>
            {record.isPending ? "Saving…" : "Record usage"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
