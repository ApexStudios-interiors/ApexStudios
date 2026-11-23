"use client";

import { useState } from "react";
import type { Role } from "@/lib/rbac/roles";
import type { InventoryItemDTO } from "@/features/inventory/queries";
import { Button } from "@/components/ui/button";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { MinimumStockDialog } from "./MinimumStockDialog";
import { RecordUsageDialog } from "./RecordUsageDialog";

type OpenDialog = "usage" | "minimum" | null;

/**
 * One inventory row's actions. Record usage: admin and site, a project's own
 * stock with something on hand (APX-69). Minimum stock: admin only (APX-15).
 * Adjust is PR #81's AdjustInventoryDialog, opened through DialogHost. Every
 * one of them is decided again by its RPC; these buttons only decide what is
 * worth offering. `role` is the EFFECTIVE role, so an admin previewing as
 * Site sees what Site sees.
 */
export function InventoryRowActions({ item, role }: { item: InventoryItemDTO; role: Role }) {
  const [open, setOpen] = useState<OpenDialog>(null);
  const isAdmin = role === "admin";
  const mayUse = (isAdmin || role === "site") && item.projectId != null && item.qtyOnHand > 0;
  if (!mayUse && !isAdmin) return null;

  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };

  return (
    <div className="flex gap-1 justify-end flex-wrap">
      {mayUse && (
        <Button variant="ghost" size="sm" onClick={() => setOpen("usage")}>
          Record usage
        </Button>
      )}
      {isAdmin && (
        <>
          <OpenDialogButton
            size="sm"
            dialog={{
              kind: "adjustInventory",
              item: { id: item.id, name: item.name, unit: item.unit, qtyOnHand: item.qtyOnHand },
            }}
            aria-label={`Adjust ${item.name}`}
          >
            Adjust
          </OpenDialogButton>
          <Button variant="ghost" size="sm" onClick={() => setOpen("minimum")}>
            Minimum
          </Button>
        </>
      )}

      {open === "usage" && item.projectId && (
        <RecordUsageDialog item={item} projectId={item.projectId} open onOpenChange={close} />
      )}
      {open === "minimum" && <MinimumStockDialog item={item} open onOpenChange={close} />}
    </div>
  );
}
