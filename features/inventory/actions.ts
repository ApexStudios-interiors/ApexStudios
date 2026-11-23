"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { adminAction, siteAction } from "@/lib/safe-action";
import { requireRole } from "@/lib/auth/session";
import { adjustInventoryFor } from "./adjust";
import { getAdjustmentHistory, type AdjustmentDTO } from "./queries";
import { recordUsageFor, setReorderLevelFor } from "./usage";
import { adjustInventorySchema, recordUsageSchema, setReorderLevelSchema } from "./schema";

function revalidateInventory(projectId: string | null) {
  if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
  revalidatePath("/inventory");
}

/** build §2.3: `adjustInventory` wraps `rpc_adjust_inventory`, admin only —
 *  the RPC re-checks it too, but the guard belongs here first. The read and
 *  the RPC call live in ./adjust.ts, shared with the mobile API. */
export const adjustInventory = adminAction
  .inputSchema(adjustInventorySchema)
  .action(async ({ parsedInput, ctx }) => {
    const item = await adjustInventoryFor(ctx.session, parsedInput);
    revalidateInventory(item.projectId);
    return { id: item.id, qtyOnHand: item.qtyOnHand };
  });

/** APX-15: Minimum stock, admin only, audited by the RPC. */
export const setReorderLevel = adminAction
  .inputSchema(setReorderLevelSchema)
  .action(async ({ parsedInput, ctx }) => {
    const item = await setReorderLevelFor(ctx.session, parsedInput);
    revalidateInventory(item.projectId);
    return { id: item.id, reorderLevel: item.reorderLevel };
  });

/** APX-69: Record usage — admin or site, never more than is on hand. */
export const recordStockUsage = siteAction
  .inputSchema(recordUsageSchema)
  .action(async ({ parsedInput, ctx }) => {
    const item = await recordUsageFor(ctx.session, parsedInput);
    revalidateInventory(item.projectId);
    return { id: item.id, qtyOnHand: item.qtyOnHand };
  });

/** `AdjustInventoryDialog`'s own "recent adjustments" fetch. Admin only, the
 *  same as the write it sits beside. */
export async function getAdjustmentHistoryForDialog(itemId: string): Promise<AdjustmentDTO[]> {
  const session = await requireRole(["admin"]);
  return getAdjustmentHistory(session, itemId);
}
