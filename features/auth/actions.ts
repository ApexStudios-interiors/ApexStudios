"use server";

import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { actionClient } from "@/lib/safe-action";
import { signInEmail } from "@/features/users/service";
import { LOGIN_LOCKED_MESSAGE, loginAllowed, recordLoginFailure } from "./login-throttle";
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
 * Throttling (APX-38, 2026-11-24): Supabase's own project-level limits
 * (supabase/config.toml [auth.rate_limit]) are per IP — and sign-in runs on
 * the server, so every user shares Vercel's addresses. The per-USERNAME
 * throttle is ./login-throttle.ts: checked before GoTrue is asked, and a
 * failure is recorded after. A locked username gets its own message — it says
 * nothing about whether the account exists, because unknown usernames are
 * counted and locked exactly like real ones.
 */

export const signInWithPassword = actionClient.inputSchema(loginSchema).action(async ({ parsedInput }) => {
  const supabase = await createClient();

  if (!(await loginAllowed(supabase, parsedInput.username))) {
    return { ok: false as const, message: LOGIN_LOCKED_MESSAGE };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: signInEmail(parsedInput.username),
    password: parsedInput.password,
  });
  if (error) {
    await recordLoginFailure(supabase, parsedInput.username);
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
