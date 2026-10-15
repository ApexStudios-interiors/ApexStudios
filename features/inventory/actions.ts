"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { adminAction } from "@/lib/safe-action";
import { requireRole } from "@/lib/auth/session";
import { adjustInventoryFor } from "./adjust";
import { getAdjustmentHistory, type AdjustmentDTO } from "./queries";
import { adjustInventorySchema } from "./schema";

/** build §2.3: `adjustInventory` wraps `rpc_adjust_inventory`, admin only —
 *  the RPC re-checks it too, but the guard belongs here first. The read and
 *  the RPC call live in ./adjust.ts, shared with the mobile API. */
export const adjustInventory = adminAction
  .inputSchema(adjustInventorySchema)
  .action(async ({ parsedInput, ctx }) => {
    const item = await adjustInventoryFor(ctx.session, parsedInput);

    if (item.projectId) revalidatePath(`/projects/${item.projectId}`, "layout");
    revalidatePath("/inventory");
    return { id: item.id, qtyOnHand: item.qtyOnHand };
  });

/** `AdjustInventoryDialog`'s own "recent adjustments" fetch. Admin only, the
 *  same as the write it sits beside. */
export async function getAdjustmentHistoryForDialog(itemId: string): Promise<AdjustmentDTO[]> {
  const session = await requireRole(["admin"]);
  return getAdjustmentHistory(session, itemId);
}
