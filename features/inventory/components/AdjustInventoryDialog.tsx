"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { adjustInventory, getAdjustmentHistoryForDialog } from "@/features/inventory/actions";
import type { AdjustmentDTO } from "@/features/inventory/queries";
import {
  ADJUST_REASONS,
  OTHER_REASON,
  adjustmentChange,
  composeAdjustReason,
  type AdjustReasonPreset,
} from "@/features/inventory/service";
import { dmy } from "@/lib/logic";
import { todayIst } from "@/lib/dates";
import { formatQty } from "@/lib/quantity";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Base UI's `Select.Value` renders the raw value unless the root is given
 *  `items` to resolve its label from. */
const REASON_ITEMS = [...ADJUST_REASONS, OTHER_REASON].map((r) => ({ value: r, label: r }));

type Item = { id: string; name: string; unit: string; qtyOnHand: number };

/**
 * Admin's Adjust, on the web — the mobile app's Adjust sheet and the same
 * `adjustInventory` action/`rpc_adjust_inventory` underneath. Sets the NEW
 * quantity on hand with a reason; the RPC records the in/out movement and the
 * audit row, and refuses anything below zero or without a reason.
 *
 * Two steps, because an adjustment is a write-off nobody can edit afterwards
 * (stock_movements is append-only — a slip needs a second, compensating
 * adjustment): the form, then a review of "before → after" and the reason,
 * and only then the save. The item's recent adjustments are listed under the
 * form, so a repeated write-off is visible before another one is made.
 */
export function AdjustInventoryDialog({ item }: { item: Item }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();

  const [step, setStep] = useState<"form" | "review">("form");
  const [newQty, setNewQty] = useState(String(item.qtyOnHand));
  const [preset, setPreset] = useState<AdjustReasonPreset>("Physical count");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AdjustmentDTO[] | null | undefined>(undefined);

  useEffect(() => {
    getAdjustmentHistoryForDialog(item.id)
      .then(setHistory)
      .catch(() => setHistory(null));
  }, [item.id]);

  const adjust = useAction(adjustInventory, {
    onSuccess: () => {
      closeDialog();
      toast(`${item.name} adjusted`);
      router.refresh();
    },
  });

  const qty = (n: number) => `${formatQty(n)} ${item.unit}`;
  const typed = Number(newQty.trim());
  const validQty = newQty.trim() !== "" && Number.isFinite(typed) && typed >= 0;
  const change = validQty ? adjustmentChange(item.qtyOnHand, typed) : null;
  const reason = composeAdjustReason(preset, note);

  const review = () => {
    if (!validQty)
      return setError(
        newQty.trim() === "" ? "Enter the new quantity on hand." : "Quantity cannot be negative."
      );
    if (change === 0) return setError("That is the current quantity — nothing to adjust.");
    if (!reason) return setError("Describe the reason.");
    setError(null);
    setStep("review");
  };

  const save = () => adjust.execute({ itemId: item.id, newQty: typed, reason });

  if (step === "review" && change !== null) {
    return (
      <DialogShell
        title="Confirm Adjustment"
        description={item.name}
        okLabel={adjust.isPending ? "Saving…" : "Confirm Adjustment"}
        okPending={adjust.isPending}
        onClose={closeDialog}
        onOk={save}
      >
        <div className="rounded-lg border border-border p-4 text-[13.5px] grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <span className="text-muted-foreground">On hand</span>
          <span className="tabular-nums">
            {qty(item.qtyOnHand)} → <span className="font-semibold">{qty(typed)}</span>
          </span>
          <span className="text-muted-foreground">Change</span>
          <span className="tabular-nums font-semibold">
            {change > 0 ? "+" : "−"}
            {qty(Math.abs(change))}
          </span>
          <span className="text-muted-foreground">Reason</span>
          <span>{reason}</span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          This is recorded in the stock history and cannot be edited. A mistake is corrected with another
          adjustment.
        </p>
        {adjust.result.serverError && (
          <p className="text-[12.5px] text-destructive mt-2">{adjust.result.serverError}</p>
        )}
        <Button
          variant="link"
          size="sm"
          className="mt-2 px-0"
          disabled={adjust.isPending}
          onClick={() => setStep("form")}
        >
          ← Back to edit
        </Button>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      title="Adjust Inventory"
      description={`${item.name} · on hand ${qty(item.qtyOnHand)}`}
      okLabel="Review"
      onClose={closeDialog}
      onOk={review}
    >
      <form
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          review();
        }}
      >
        <Field
          label={`New quantity on hand (${item.unit})`}
          htmlFor="adj-qty"
          hint={
            change !== null && change !== 0
              ? `Change ${change > 0 ? "+" : "−"}${qty(Math.abs(change))}`
              : undefined
          }
        >
          <input
            id="adj-qty"
            className={inputClass + " tabular-nums"}
            inputMode="decimal"
            autoFocus
            value={newQty}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setNewQty(e.target.value);
              setError(null);
            }}
          />
        </Field>
        <Field label="Reason" htmlFor="adj-reason">
          <Select
            items={REASON_ITEMS}
            value={preset}
            onValueChange={(v) => {
              if (v) setPreset(v as AdjustReasonPreset);
              setError(null);
            }}
          >
            <SelectTrigger id="adj-reason" className="w-full text-[13.5px] data-[size=default]:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {REASON_ITEMS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <div className="col-span-2">
          <Field label={preset === OTHER_REASON ? "Details" : "Note"} htmlFor="adj-note">
            <input
              id="adj-note"
              className={inputClass}
              placeholder={preset === OTHER_REASON ? "What happened?" : "Optional"}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setError(null);
              }}
            />
          </Field>
        </div>
        {error && <p className="col-span-2 text-xs text-destructive -mt-2">{error}</p>}
        {/* Enter submits; the visible button is DialogShell's own. */}
        <button type="submit" hidden />
      </form>

      <div className="mt-5 border-t border-border pt-4">
        <div className="text-[12.5px] font-semibold mb-2">Recent adjustments</div>
        <AdjustmentHistory history={history} unit={item.unit} />
      </div>
    </DialogShell>
  );
}

function AdjustmentHistory({ history, unit }: { history: AdjustmentDTO[] | null | undefined; unit: string }) {
  if (history === undefined) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (history === null) return <p className="text-xs text-muted-foreground">Could not load the history.</p>;
  if (history.length === 0) return <p className="text-xs text-muted-foreground">No adjustments yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {history.map((h) => (
        <li key={h.id} className="py-2 flex items-baseline gap-3 text-[12.5px]">
          <span className="w-[84px] shrink-0 text-muted-foreground whitespace-nowrap">
            {dmy(todayIst(new Date(h.createdAt)))}
          </span>
          <span className="w-[96px] shrink-0 tabular-nums font-medium whitespace-nowrap">
            {h.change > 0 ? "+" : "−"}
            {formatQty(Math.abs(h.change))} {unit}
          </span>
          <span className="min-w-0 flex-1 truncate" title={h.reason ?? undefined}>
            {h.reason ?? "–"}
          </span>
          <span className="shrink-0 text-muted-foreground whitespace-nowrap">{h.byName ?? "–"}</span>
        </li>
      ))}
    </ul>
  );
}
