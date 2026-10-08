import "server-only";
import type { Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { searchAll } from "./queries";
import type { SearchResultDTO } from "./service";

/**
 * One global search, for every caller — the web header's `searchAll` action
 * (./actions.ts) and the mobile API. Each authenticates and validates
 * (searchAllSchema: trimmed, at least two characters) first.
 *
 * 20/minute per user (`rpc_check_rate_limit`): generous for a debounced human
 * typing, tight enough that a scripted hammer on this "unauthenticated-
 * feeling" input (build/07 §2.7's own phrase) hits a wall instead of seven
 * scans per keystroke — so the limit is shared by the web and the app.
 * Then queries.ts's role-scoped searches, capped by service.ts.
 */
export async function searchFor(session: Session, query: string): Promise<SearchResultDTO[]> {
  const supabase = await createClient();
  const { data: allowed, error } = await supabase.rpc("rpc_check_rate_limit", {
    p_action: "search",
    p_max_per_window: 20,
    p_window_seconds: 60,
  });
  if (error) throw new Error(error.message);
  if (!allowed) throw new Error("RATE_LIMITED: too many searches, slow down");

  return searchAll(session, query);
}
