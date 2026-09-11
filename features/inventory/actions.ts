"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction } from "@/lib/safe-action";
import { adjustInventorySchema } from "./schema";

/** build §2.3: `adjustInventory` wraps `rpc_adjust_inventory`, admin only —
 *  the RPC re-checks it too, but the guard belongs here first. */
export const adjustInventory = adminAction
  .inputSchema(adjustInventorySchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rpc_adjust_inventory", {
      p_item_id: parsedInput.itemId,
      p_new_qty: parsedInput.newQty,
      p_reason: parsedInput.reason,
    });
    if (error) throw new Error(error.message);
    // `returns public.inventory_items` generates as `unknown` — scripts/gen-types.mjs
    // only maps scalar Postgres types, not composite/row ones.
    const row = data as { id: string; project_id: string | null; qty_on_hand: number };

    if (row.project_id) revalidatePath(`/projects/${row.project_id}`, "layout");
    revalidatePath("/inventory");
    return { id: row.id, qtyOnHand: row.qty_on_hand };
  });
