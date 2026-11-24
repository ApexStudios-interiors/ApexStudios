import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The per-username sign-in throttle (APX-38, migration 20261124100009). The
 * rule — 10 failures for one username within 15 minutes locks it until the
 * window ends — is decided in the database, never here: the caller passes the
 * username and nothing else, so no request can widen its own allowance.
 *
 * Both calls FAIL OPEN, deliberately. A throttle lookup that errors (the
 * migration not yet applied after a deploy, a transient database fault) must
 * not lock every user out of the only sign-in there is; Supabase Auth's own
 * limits still apply, and the failure is logged so it is seen.
 */
export const LOGIN_LOCKED_MESSAGE =
  "Too many sign-in attempts for this username. Wait 15 minutes and try again.";

export async function loginAllowed(supabase: Client, username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("rpc_login_allowed", { p_username: username });
  if (error) {
    console.error("[auth] login throttle check failed; allowing the attempt", error.message);
    return true;
  }
  return data !== false;
}

export async function recordLoginFailure(supabase: Client, username: string): Promise<void> {
  const { error } = await supabase.rpc("rpc_login_record_failure", { p_username: username });
  if (error) console.error("[auth] could not record a failed sign-in", error.message);
}
