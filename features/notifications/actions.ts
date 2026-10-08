"use server";

import "server-only";
import { authedAction } from "@/lib/safe-action";
import { markNotificationReadFor } from "./read";
import { markNotificationReadSchema } from "./schema";

/**
 * Records that the caller has opened one notification (D60). The upsert —
 * own row only, the id from the session, `read_at` refreshed on a second
 * open — lives in ./read.ts, shared with the mobile API.
 */
export const markNotificationRead = authedAction
  .inputSchema(markNotificationReadSchema)
  .action(async ({ parsedInput, ctx }) => {
    await markNotificationReadFor(ctx.session, parsedInput);
    return { ok: true as const };
  });
