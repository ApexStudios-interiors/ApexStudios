"use server";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { authedAction } from "@/lib/safe-action";
import { markNotificationReadSchema } from "./schema";

/**
 * Records that the caller has opened one notification (D60).
 *
 * Runs on the user's own client, so RLS decides: `nr_insert_own` /
 * `nr_update_own` allow only `profile_id = auth.uid()`, and the id is taken
 * from the session rather than the input, so a caller cannot mark anything
 * read on someone else's behalf.
 *
 * An upsert, not an insert: opening the same notification twice is normal,
 * and the second open must refresh `read_at`. That refresh is what keeps
 * re-raised work correct — see `isUnread` in ./service.
 *
 * Note it records the REAL user, not an impersonated one. Read state is a
 * property of the person clicking, and Build 05's rule is that impersonation
 * only ever shapes reads — an owner previewing as Site must not be able to
 * mark the site supervisor's notifications read.
 */
export const markNotificationRead = authedAction
  .inputSchema(markNotificationReadSchema)
  .action(async ({ parsedInput }) => {
    const session = await requireSession();
    const supabase = await createClient();

    const { error } = await supabase.from("notification_reads").upsert(
      {
        profile_id: session.userId,
        kind: parsedInput.kind,
        entity_id: parsedInput.entityId,
        read_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,kind,entity_id" }
    );
    if (error) throw new Error(error.message);

    return { ok: true as const };
  });
