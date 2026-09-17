"use server";

import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { actionClient } from "@/lib/safe-action";
import { signInEmail } from "@/features/users/service";
import { loginSchema } from "./schema";

/**
 * The one place `actionClient` (no guard) is used, exactly as
 * build/03-auth-and-rbac.md §2.6 specifies — everything past this point
 * requires a session.
 *
 * D51: every role — owner, admin, site supervisor and client — signs in here
 * with username + password. There is no magic link and no other sign-in path,
 * and nothing in the app asks Supabase to send an auth email.
 *
 * DEFERRED (recorded, not silently skipped): §2.7's "per-IP and per-email
 * throttle in the action". Supabase's own project-level limits are live today
 * via supabase/config.toml [auth.rate_limit] (sign_in_sign_ups) — real
 * protection, not a placeholder — but they are project-wide, not per-account.
 * An additional per-account cooldown needs a small table and is left for a
 * follow-up rather than rushed here.
 */

export const signInWithPassword = actionClient.inputSchema(loginSchema).action(async ({ parsedInput }) => {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: signInEmail(parsedInput.username),
    password: parsedInput.password,
  });
  if (error) {
    // Never reveal whether the account exists — the message is identical
    // either way, decided here rather than left to whatever GoTrue said.
    // Returned, not thrown: lib/safe-action.ts's mapDomainError replaces any
    // unmapped thrown message with "Something went wrong. Reference: …", which
    // is what a mistyped password used to show.
    return { ok: false as const, message: "Incorrect username or password." };
  }

  // D48: password only — no two-factor step for any role.
  return { ok: true as const };
});

export async function signOut(): Promise<never> {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
