"use server";

import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { actionClient } from "@/lib/safe-action";
import { clientEnv } from "@/lib/env.client";
import { staffLoginSchema, magicLinkSchema } from "./schema";

/**
 * The one place `actionClient` (no guard) is used, exactly as
 * build/03-auth-and-rbac.md §2.6 specifies — everything past this point
 * requires a session.
 *
 * DEFERRED (recorded, not silently skipped): §2.7's "per-IP and per-email
 * throttle in the action". Supabase's own project-level limits are live today
 * via supabase/config.toml [auth.rate_limit] (email_sent, sign_in_sign_ups,
 * token_verifications) — real protection, not a placeholder — but they are
 * project-wide, not per-address. An additional per-email cooldown needs a
 * small table and is left for a follow-up rather than rushed here.
 */

export const signInWithPassword = actionClient
  .inputSchema(staffLoginSchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();

    const { error } = await supabase.auth.signInWithPassword(parsedInput);
    if (error) {
      // Never reveal whether the email exists — the message is identical either
      // way, mapped at this boundary rather than left to whatever GoTrue said.
      throw new Error("Incorrect email or password.");
    }

    // D48: password only — no two-factor step for any role.
    return { ok: true as const };
  });

export const requestMagicLink = actionClient.inputSchema(magicLinkSchema).action(async ({ parsedInput }) => {
  const supabase = await createClient();
  // emailRedirectTo must be an allow-listed URL in Supabase's Redirect URLs
  // setting (build/03-auth-and-rbac.md §0.1) — a mismatch fails silently on
  // Supabase's side with no server-side log, which is why that prerequisite
  // exists.
  const { error } = await supabase.auth.signInWithOtp({
    email: parsedInput.email,
    options: { emailRedirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/auth/callback` },
  });
  // Deliberately the same success response whether or not the email exists —
  // otherwise this endpoint becomes a way to enumerate client email addresses.
  if (error) throw new Error("Could not send the link. Try again in a moment.");
  return { ok: true as const };
});

export async function signOut(): Promise<never> {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
