/**
 * build/07-stock-inventory-notifications.md §2.3, §3. Pure oracle for
 * `v_inventory_status`/`v_inventory_site`'s own `stock_status` case
 * expression (`supabase/migrations/20260909170013_views_rollups.sql`) — the
 * SQL is the real, authoritative computation; this exists to test that exact
 * boundary logic without a database round trip, and to give the client a
 * consistent label if it ever needs one ahead of a fresh fetch.
 */
export type InventoryStatus = "critical" | "low" | "ok";

export function inventoryStatus(qtyOnHand: number, reorderLevel: number): InventoryStatus {
  if (qtyOnHand === 0) return "critical";
  if (qtyOnHand < reorderLevel) return "low";
  return "ok";
}
