"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { adminAction } from "@/lib/safe-action";
import { adjustInventoryFor } from "./adjust";
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
