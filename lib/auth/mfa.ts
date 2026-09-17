import type { Role } from "@/lib/rbac/roles";

/**
 * architecture.md T12: TOTP is mandatory for owner and admin. Pure, so the
 * rules lib/auth/session.ts enforces and the ones the login page, the app
 * shell and /mfa route by are provably the same rules (mfa.test.ts).
 */
export function requiresMfa(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Which two-factor screen, if any, a signed-in user must pass before the app.
 *
 * - "none": done — MFA completed this session, or the role doesn't need it.
 * - "challenge": a verified TOTP factor exists; enter a code from it.
 * - "enroll": no verified factor yet; set one up (D22 — this step was missing,
 *   so no real owner/admin could ever reach aal2).
 */
export type MfaStep = "none" | "challenge" | "enroll";

export function mfaStep(input: { role: Role; aal: "aal1" | "aal2"; hasVerifiedTotp: boolean }): MfaStep {
  if (input.aal === "aal2" || !requiresMfa(input.role)) return "none";
  return input.hasVerifiedTotp ? "challenge" : "enroll";
}

/**
 * `?next=` comes from the URL, so it is attacker-controlled. Only same-origin
 * paths are followed; "//evil.com" and "/\evil.com" are protocol-relative
 * redirects in browsers and are refused too.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
