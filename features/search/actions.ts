"use server";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { authedAction } from "@/lib/safe-action";
import { searchAllSchema } from "./schema";
import { searchAll as searchAllQuery } from "./queries";

/**
 * build/07-stock-inventory-notifications.md §2.7. Guard (authed + rate
 * limit), parse, delegate to queries.ts, return — no business arithmetic
 * here (AGENTS.md's own layering rule); the per-entity role scoping and the
 * result caps both live in queries.ts/service.ts.
 *
 * 20/minute per user: generous for a debounced human typing, tight enough
 * that a scripted hammer on this "unauthenticated-feeling" input (the
 * build's own phrase) hits a wall instead of seven unindexed-adjacent scans
 * per keystroke.
 */
export const searchAll = authedAction.inputSchema(searchAllSchema).action(async ({ parsedInput, ctx }) => {
  const supabase = await createClient();
  const { data: allowed, error } = await supabase.rpc("rpc_check_rate_limit", {
    p_action: "search",
    p_max_per_window: 20,
    p_window_seconds: 60,
  });
  if (error) throw new Error(error.message);
  if (!allowed) throw new Error("RATE_LIMITED: too many searches, slow down");

  return searchAllQuery(ctx.session, parsedInput.query);
});
