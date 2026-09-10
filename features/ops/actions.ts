"use server";

import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction } from "@/lib/safe-action";

/** build §3.7: `jobs` has no user-writable path — `rpc_retry_job` (admin-only,
 *  checked inside the function too) is the only way in. */
export const retryJob = adminAction
  .inputSchema(z.object({ id: z.uuid() }))
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("rpc_retry_job", { p_id: parsedInput.id });
    if (error) throw new Error(error.message);

    revalidatePath("/ops/jobs");
    return { ok: true as const };
  });
