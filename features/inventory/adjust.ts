import "server-only";
import type { Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { inventoryStatus, type InventoryStatus } from "./service";
import type { AdjustInventoryInput } from "./schema";

/**
 * Adjusting one inventory item, once, for every caller — the web's
 * `adjustInventory` action (./actions.ts) and the mobile API. Each
 * authenticates, checks the role (admin) and validates
 * (adjustInventorySchema: the NEW quantity on hand, 0 or more, and a reason)
 * first.
 *
 * Reads the item through the caller's own RLS first (`inventory_select`:
 * this org, admin/site, the item's project or the central store), so an item
 * the caller cannot see is NOT_FOUND before anything is written —
 * rpc_adjust_inventory itself checks admin but not the item's org. Then the
 * RPC decides and does everything real: admin only, a reason, never below
 * zero, the row lock, no-op when unchanged, the `stock_movements` row (in or
 * out, with the reason), the new `qty_on_hand`, and the `adjust` audit row.
 *
 * Returns the item's new quantity, its minimum stock and the status the SQL
 * rule gives them (`inventoryStatus`, the views' own case expression) — what
 * a caller needs to show the result. Errors are thrown as `Error(message)`,
 * so each caller's mapDomainError applies unchanged. No caching or
 * revalidation here — that is the web action's concern.
 */
export async function adjustInventoryFor(
  // The RPC reads the caller from the JWT on this client. Kept so every
  // shared write helper has the same shape.
  _session: Session,
  input: AdjustInventoryInput
): Promise<{
  id: string;
  projectId: string | null;
  qtyOnHand: number;
  reorderLevel: number;
  status: InventoryStatus;
}> {
  const supabase = await createClient();

  const { data: visible, error: readError } = await supabase
    .from("inventory_items")
    .select("id")
    .eq("id", input.itemId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!visible) throw new Error("NOT_FOUND: this inventory item no longer exists");

  const { data, error } = await supabase.rpc("rpc_adjust_inventory", {
    p_item_id: input.itemId,
    p_new_qty: input.newQty,
    p_reason: input.reason,
  });
  if (error) throw new Error(error.message);
  // `returns public.inventory_items` generates as `unknown` — scripts/gen-types.mjs
  // only maps scalar Postgres types, not composite/row ones. Only these
  // columns are read.
  const row = data as { id: string; project_id: string | null; qty_on_hand: number; reorder_level: number };
  const qtyOnHand = Number(row.qty_on_hand);
  const reorderLevel = Number(row.reorder_level);
  return {
    id: row.id,
    projectId: row.project_id,
    qtyOnHand,
    reorderLevel,
    status: inventoryStatus(qtyOnHand, reorderLevel),
  };
}
