import "server-only";
import type { Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { inventoryStatus, type InventoryStatus } from "./service";
import type { RecordUsageInput, SetReorderLevelInput } from "./schema";

/**
 * Two inventory writes added by 20261124400002, each shared by the web action
 * (./actions.ts) and — for usage — the mobile API, the same way ./adjust.ts is.
 * Every real rule is the RPC's: role, organisation and project scoping, the
 * row lock, never below zero, the movement and the audit row. Both RPCs
 * return quantities only (jsonb with no unit_cost), so nothing here can carry
 * money to a site session even by accident.
 *
 * Errors are thrown as `Error(message)`, so each caller's mapDomainError
 * applies unchanged. No caching or revalidation — that is the web action's.
 */

export type InventoryQtyResult = {
  id: string;
  projectId: string | null;
  qtyOnHand: number;
  reorderLevel: number;
  status: InventoryStatus;
};

function toResult(data: unknown): InventoryQtyResult {
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

/** APX-69 — "Record usage": an 'out' movement against a package. */
export async function recordUsageFor(_session: Session, input: RecordUsageInput): Promise<InventoryQtyResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_record_stock_usage", {
    p_item_id: input.itemId,
    p_package_id: input.packageId,
    p_qty: input.qty,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  return toResult(data);
}

/** APX-15 — Minimum stock. Admin only (the RPC checks). */
export async function setReorderLevelFor(
  _session: Session,
  input: SetReorderLevelInput
): Promise<InventoryQtyResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_set_inventory_reorder_level", {
    p_item_id: input.itemId,
    p_reorder_level: input.reorderLevel,
  });
  if (error) throw new Error(error.message);
  return toResult(data);
}
