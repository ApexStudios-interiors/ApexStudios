import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * build/07-stock-inventory-notifications.md §2.4. Nightly at 02:00 IST.
 * Recomputes `qty_on_hand` from `stock_movements` (`rpc_inventory_drift`'s
 * own single indexed aggregate — build §4's own exit criterion is index
 * scans at 5,000 items, not this handler pulling every row into memory) and
 * compares it against the cache.
 *
 * "Do not silently correct the cache" (build §5): a drift means an
 * un-ledgered mutation exists somewhere in the code, and overwriting the
 * evidence removes the only signal that the bug is there. This handler logs
 * every drifting item and THROWS — landing the job in `failed` on the
 * Admin ops page is the alert. The `inventory-drift.md` runbook (Build 10)
 * is what actually fixes a drift: find the un-ledgered write, post a
 * compensating `adjust` movement with a reason, then fix the code path.
 */
export async function reconcileInventory(): Promise<void> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("rpc_inventory_drift");
  if (error) throw new Error(error.message);

  if (data.length === 0) return;

  for (const d of data) {
    console.error(
      `inventory.reconcile: drift on "${d.name}" (${d.item_id}) — cache=${d.cached_qty}, ledger=${d.ledger_qty}`
    );
  }

  throw new Error(
    `DRIFT_DETECTED: ${data.length} inventory item(s) disagree with their own ledger — see the inventory-drift.md runbook`
  );
}
