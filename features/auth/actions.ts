"use server";

import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { actionClient, authedAction } from "@/lib/safe-action";
import { requiresMfa } from "@/lib/auth/mfa";
import { ForbiddenError } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env.client";
import { staffLoginSchema, magicLinkSchema, totpVerifySchema, totpCodeSchema } from "./schema";

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

    const { data: signIn, error } = await supabase.auth.signInWithPassword(parsedInput);
    if (error) {
      // Never reveal whether the email exists — the message is identical either
      // way, mapped at this boundary rather than left to whatever GoTrue said.
      throw new Error("Incorrect email or password.");
    }

    // 01-hld.md §6: TOTP required for admin/owner. If the account has an
    // enrolled factor and hasn't completed it this session, the client needs a
    // challenge before it can call anything role-gated — lib/auth/session.ts's
    // requireRole() checks the session's aal, so signing in without finishing
    // this step gets FORBIDDEN on the first admin/owner action, not silently in.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp[0];
      if (factor) {
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
          factorId: factor.id,
        });
        if (challengeError) throw new Error("Could not start the verification step. Try again.");
        return {
          needsMfa: true as const,
          needsEnrollment: false as const,
          factorId: factor.id,
          challengeId: challenge.id,
        };
      }
    }

    // D22: an owner/admin with no verified factor yet cannot reach aal2 at
    // all, so every admin-gated action would refuse them. Send them to set one
    // up now instead. Their own profile row is readable under RLS.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", signIn.user.id)
      .single();
    if (profile && requiresMfa(profile.role)) {
      return { needsMfa: false as const, needsEnrollment: true as const };
    }

    return { needsMfa: false as const, needsEnrollment: false as const };
  });

/**
 * D22: TOTP enrollment. Starts (or restarts) setup and returns the QR code and
 * the text secret for manual entry. Only for roles that require MFA — nothing
 * else in the app would ever challenge anyone else's factor.
 *
 * Stale UNVERIFIED factors (a setup abandoned before its first code) are
 * removed first: factor friendly names must be unique per user, so leaving one
 * behind would make every retry fail. A VERIFIED factor is never touched here —
 * replacing it is a recovery operation (scripts/reset-mfa.mjs), not something
 * an aal1 session may do.
 */
export const startTotpEnrollment = authedAction.action(async ({ ctx }) => {
  if (!requiresMfa(ctx.session.role)) throw new ForbiddenError("MFA enrollment is for owner/admin");
  const supabase = await createClient();

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) throw new Error("Could not load your security settings. Try again.");
  if (factors.totp.length > 0) return { alreadyEnrolled: true as const };

  for (const stale of factors.all.filter((f) => f.factor_type === "totp" && f.status !== "verified")) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator app",
    issuer: "Apex Projects",
  });
  if (error) throw new Error("Could not start two-factor setup. Try again.");

  return {
    alreadyEnrolled: false as const,
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
});

/**
 * D22: the first correct code both verifies the new factor and upgrades this
 * session to aal2 — Supabase writes the refreshed session cookie here — so the
 * user lands in the app already past requireRole's MFA check. The same call
 * answers a challenge for an already-verified factor (/mfa, when an aal1
 * session reaches the app shell).
 */
export const verifyTotpCode = authedAction.inputSchema(totpCodeSchema).action(async ({ parsedInput }) => {
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify(parsedInput);
  if (error) throw new Error("That code didn't work. Check your authenticator app and try again.");
  return { ok: true as const };
});

export const verifyTotp = actionClient.inputSchema(totpVerifySchema).action(async ({ parsedInput }) => {
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.verify(parsedInput);
  if (error) throw new Error("That code didn't work. Check your authenticator app and try again.");
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
