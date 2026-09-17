/**
 * Pure. No next/* imports — testable against a plain connection or no
 * connection at all (HLD §4.3, code-standards §1).
 */

import type { Role } from "@/lib/rbac/roles";

/**
 * Every seeded staff account is @beapex.in (supabase/seed.sql: hello@,
 * suresh@, prakash@, meena@, ravi@), and it is the address the owner already
 * signs in with. A username becomes `<username>@beapex.in`.
 */
export const USER_EMAIL_DOMAIN = "beapex.in";

export function emailForUsername(username: string): string {
  return `${username}@${USER_EMAIL_DOMAIN}`;
}

/**
 * What the sign-in form's Username field becomes (D51: every role signs in
 * with username + password). A bare username is `<username>@beapex.in`.
 *
 * Something that already contains an @ is used as the address unchanged, so an
 * account whose email is not on the Apex domain can still sign in — today that
 * is the seeded client (tvrao@example.invalid), which predates usernames.
 */
export function signInEmail(input: string): string {
  const value = input.trim().toLowerCase();
  return value.includes("@") ? value : emailForUsername(value);
}

/**
 * The steps of creating an account, injected so the ordering and the
 * compensation can be tested without GoTrue or a database. The real
 * implementations are in features/users/actions.ts.
 */
export type ProvisionSteps = {
  createAuthUser: (input: {
    email: string;
    password: string;
  }) => Promise<{ ok: true; userId: string } | { ok: false; reason: "email_exists" }>;
  deleteAuthUser: (userId: string) => Promise<void>;
  /** Inserts the profiles row. Throws on failure. */
  insertProfile: (userId: string, email: string) => Promise<void>;
  /** Anything else the account needs before it counts as created — e.g. a
   *  project membership. Throws on failure. */
  afterProfile?: (userId: string) => Promise<void>;
  /** Called only if compensation itself fails, with the id to reconcile. */
  onOrphan?: (userId: string, cleanupError: unknown) => void;
};

export type ProvisionResult =
  { status: "username_taken" } | { status: "created"; userId: string; email: string; password: string };

/**
 * Auth user → profile → (optional) further step, across two systems, so not
 * one transaction (build/03 §2.10). If ANY step after the auth user exists
 * fails, the auth user is deleted before the error propagates. That one delete
 * is the whole cleanup: profiles.id references auth.users(id) ON DELETE
 * CASCADE, and project_members.profile_id references profiles(id) ON DELETE
 * CASCADE, so a half-made profile or membership goes with it.
 *
 * The password is generated here and appears only in the success result. The
 * error that propagates is the failing step's own, which never carries it.
 */
export async function provisionAccount(
  steps: ProvisionSteps,
  username: string,
  random: RandomSource = webCrypto
): Promise<ProvisionResult> {
  const email = emailForUsername(username);
  const password = generatePassword(random);

  const created = await steps.createAuthUser({ email, password });
  if (!created.ok) return { status: "username_taken" };

  try {
    await steps.insertProfile(created.userId, email);
    if (steps.afterProfile) await steps.afterProfile(created.userId);
  } catch (failure) {
    try {
      await steps.deleteAuthUser(created.userId);
    } catch (cleanupError) {
      steps.onOrphan?.(created.userId, cleanupError);
    }
    throw failure;
  }

  return { status: "created", userId: created.userId, email, password };
}

/**
 * The username shown for an existing account: the part before the @ for an
 * Apex address (what the sign-in form accepts on its own), else the whole
 * address — which signInEmail also accepts as typed, e.g. the seeded client.
 */
export function usernameForEmail(email: string): string {
  const suffix = `@${USER_EMAIL_DOMAIN}`;
  const value = email.trim().toLowerCase();
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

// ── Reset password (D52) ─────────────────────────────────────────────────────

/** The caller, by their REAL session role — never the D20 preview role. */
export type ResetActor = { userId: string; role: Role };

/** The target as read through the caller's RLS-scoped client. */
export type ResetTarget = {
  id: string;
  role: Role;
  isActive: boolean;
  deletedAt: string | null;
  email: string | null;
};

export type ResetRefusal =
  /** Not visible to the caller (another org, never existed) or soft-deleted. */
  | "not_found"
  | "self"
  /** The caller is not owner/admin, or is an admin and the target is owner/admin. */
  | "forbidden_role"
  | "inactive"
  /** No email, so no username to sign in with (D51). */
  | "no_email";

/**
 * Who may reset whom. The single source of the rule for both the Users page
 * (whether to offer the button) and resetUserPassword (whether to do it);
 * rpc_record_password_reset re-checks the same rule in the database.
 *
 *   owner → any other user
 *   admin → site and client only. Never the owner and never another admin:
 *           resetting a higher-or-equal account's password and signing in as
 *           it is privilege escalation.
 *   nobody → themselves
 *
 * A null target is one the caller's RLS-scoped read did not return, which is
 * exactly what a user in another org looks like.
 */
export function passwordResetRefusal(actor: ResetActor, target: ResetTarget | null): ResetRefusal | null {
  if (actor.role !== "owner" && actor.role !== "admin") return "forbidden_role";
  if (!target || target.deletedAt !== null) return "not_found";
  if (target.id === actor.userId) return "self";
  if (actor.role === "admin" && target.role !== "site" && target.role !== "client") return "forbidden_role";
  if (!target.isActive) return "inactive";
  if (!target.email) return "no_email";
  return null;
}

export function canResetPassword(actor: ResetActor, target: ResetTarget): boolean {
  return passwordResetRefusal(actor, target) === null;
}

/** The steps of a reset, injected like ProvisionSteps; real ones in actions.ts. */
export type ResetSteps = {
  /** The target through the caller's RLS-scoped client; null if not visible. */
  loadTarget: (userId: string) => Promise<ResetTarget | null>;
  /** rpc_record_password_reset: re-authorises in the database and writes the
   *  audit row. Throws if the database refuses. Takes no password. */
  recordReset: (userId: string) => Promise<void>;
  /** GoTrue admin update. Also deletes every session the user has (D52). */
  setAuthPassword: (userId: string, password: string) => Promise<void>;
};

export type ResetResult =
  | { status: "refused"; reason: ResetRefusal }
  | { status: "reset"; userId: string; username: string; email: string; password: string };

/**
 * Check → audit (with the database's own check) → set the password. The
 * password is generated only after both checks pass, is handed only to
 * setAuthPassword, and appears only in the success result — never in a
 * refusal, and never in an error, which is always the failing step's own.
 */
export async function resetAccountPassword(
  steps: ResetSteps,
  actor: ResetActor,
  targetId: string,
  random: RandomSource = webCrypto
): Promise<ResetResult> {
  const target = await steps.loadTarget(targetId);
  const refusal = passwordResetRefusal(actor, target);
  if (refusal || !target?.email) return { status: "refused", reason: refusal ?? "no_email" };

  await steps.recordReset(target.id);

  const password = generatePassword(random);
  await steps.setAuthPassword(target.id, password);

  return {
    status: "reset",
    userId: target.id,
    username: usernameForEmail(target.email),
    email: target.email,
    password,
  };
}

// ── Change role, deactivate / reactivate ─────────────────────────────────────

/** The caller and the target, by the same shapes the reset rule uses. */
export type UserAdminActor = ResetActor;
export type UserAdminTarget = Omit<ResetTarget, "email">;

export type UserAdminRefusal =
  /** Not visible to the caller (another org, never existed) or soft-deleted. */
  | "not_found"
  | "self"
  /** The caller is not owner/admin, or is an admin and the target is owner/admin. */
  | "forbidden_role"
  /** The role asked for is not one this caller may assign — today, always `owner`. */
  | "unassignable_role"
  /** The target is already in that role or that state. */
  | "no_change"
  /** The change would leave the org with no active owner. */
  | "last_owner";

/**
 * Who may act on whom. Deliberately the same rule as passwordResetRefusal
 * (D52) — an admin who may take over a site account's password is not made
 * safer by being unable to change its role, and one who may not touch the
 * owner's password must not be able to demote or deactivate them either:
 *
 *   owner → any other user
 *   admin → site and client only. Never the owner and never another admin:
 *           an admin who could demote the owner, or deactivate them, could
 *           lock the organisation out of its own highest privilege.
 *   nobody → themselves. A self-demotion cannot be undone by the person who
 *           made it, and deactivating yourself is the one move that can strand
 *           an org with nobody able to put it back.
 *
 * It differs from passwordResetRefusal in exactly one place, and the
 * difference is the feature: a DEACTIVATED target is not refused here, because
 * reactivating one is the whole point of the control being reversible.
 *
 * A null target is one the caller's RLS-scoped read did not return, which is
 * exactly what a user in another org looks like.
 */
export function userAdminRefusal(
  actor: UserAdminActor,
  target: UserAdminTarget | null
): UserAdminRefusal | null {
  if (actor.role !== "owner" && actor.role !== "admin") return "forbidden_role";
  if (!target || target.deletedAt !== null) return "not_found";
  if (target.id === actor.userId) return "self";
  if (actor.role === "admin" && target.role !== "site" && target.role !== "client") return "forbidden_role";
  return null;
}

/**
 * The roles this caller may put this target into. `owner` is never among them
 * (D8: there is one owner, and addUserSchema keeps it out of Add User for the
 * same reason) — promoting a successor is a deliberate out-of-band act, done
 * in SQL, not a dropdown. An admin may still promote a site user to admin:
 * Add User already lets them create one outright, so refusing it here would
 * close a door that is open next to it.
 */
export const ASSIGNABLE_ROLES = ["admin", "site", "client"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAssignableRole(role: Role): role is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly Role[]).includes(role);
}

/**
 * The org must never be left with no active owner. The count is the caller's
 * own RLS-scoped read, so this is a courtesy check for the UI and an early
 * refusal for the action — the authoritative one is in the database, inside
 * the same statement that performs the change (migration 20260918090001).
 */
export type OwnerCount = { activeOwners: number };

/** Only worth a query when the target is the kind of row that could be the last owner. */
function needsOwnerCount(target: UserAdminTarget | null): boolean {
  return target?.role === "owner" && target.isActive;
}

/**
 * The target is the org's only active owner today, and the change being asked
 * for would stop them being one — by taking the role away, or by deactivating
 * the account that holds it. Both callers below have already established that
 * the change does exactly that (no caller may assign `owner`, and only a
 * deactivation reaches this from the other one).
 */
function wouldStrandOrg(target: UserAdminTarget, ctx: OwnerCount): boolean {
  return target.role === "owner" && target.isActive && ctx.activeOwners <= 1;
}

export function roleChangeRefusal(
  actor: UserAdminActor,
  target: UserAdminTarget | null,
  nextRole: Role,
  ctx: OwnerCount
): UserAdminRefusal | null {
  const refusal = userAdminRefusal(actor, target);
  if (refusal || !target) return refusal ?? "not_found";
  if (!isAssignableRole(nextRole)) return "unassignable_role";
  if (target.role === nextRole) return "no_change";
  if (wouldStrandOrg(target, ctx)) return "last_owner";
  return null;
}

/**
 * Why the Users page's Role select is disabled on a row, before any role has
 * been picked: the reason that applies to every role the caller could pick.
 * The action and the database still check the specific pick.
 */
export function roleControlRefusal(
  actor: UserAdminActor,
  target: UserAdminTarget | null,
  ctx: OwnerCount
): UserAdminRefusal | null {
  for (const role of ASSIGNABLE_ROLES) {
    const refusal = roleChangeRefusal(actor, target, role, ctx);
    if (refusal === null) return null; // at least one role is a legal pick
    if (refusal !== "no_change") return refusal; // the same reason for all of them
  }
  return "no_change";
}

export function activeChangeRefusal(
  actor: UserAdminActor,
  target: UserAdminTarget | null,
  nextActive: boolean,
  ctx: OwnerCount
): UserAdminRefusal | null {
  const refusal = userAdminRefusal(actor, target);
  if (refusal || !target) return refusal ?? "not_found";
  if (target.isActive === nextActive) return "no_change";
  if (!nextActive && wouldStrandOrg(target, ctx)) return "last_owner";
  return null;
}

/** Whether to offer either control on a Users row at all, before a value is picked. */
export function canAdministerUser(actor: UserAdminActor, target: UserAdminTarget): boolean {
  return userAdminRefusal(actor, target) === null;
}

/**
 * The steps of each operation, injected like ResetSteps; the real ones are in
 * features/users/actions.ts.
 */
export type UserAdminSteps = {
  /** The target through the caller's RLS-scoped client; null if not visible. */
  loadTarget: (userId: string) => Promise<UserAdminTarget | null>;
  /** Active owners in the caller's org, through the same client. */
  countActiveOwners: () => Promise<number>;
  /** rpc_set_user_role / rpc_set_user_active: authorise (again), change, audit. */
  applyRole: (userId: string, role: AssignableRole) => Promise<void>;
  applyActive: (userId: string, isActive: boolean) => Promise<void>;
  /**
   * Ends every session the user holds. For a role change this is the whole
   * mechanism: the JWT carries app_role until it expires, and RLS trusts that
   * claim, so a demotion that leaves the session alone is not yet in force.
   */
  revokeSessions: (userId: string) => Promise<void>;
  /**
   * GoTrue ban / unban. Deactivation needs it: is_active lives in `profiles`,
   * which GoTrue knows nothing about, so without a ban a deactivated user can
   * simply sign in again and keep a valid token.
   */
  setBanned: (userId: string, banned: boolean) => Promise<void>;
};

export type UserAdminResult<T> = { status: "refused"; reason: UserAdminRefusal } | ({ status: "done" } & T);

/**
 * Check → change (the database checks again, and takes the last-owner lock) →
 * end the user's sessions. The order matters both ways round: nothing is
 * revoked for a change that did not happen, and no changed session outlives
 * the change by more than the request.
 */
export async function changeUserRole(
  steps: UserAdminSteps,
  actor: UserAdminActor,
  targetId: string,
  nextRole: Role
): Promise<UserAdminResult<{ userId: string; from: Role; to: AssignableRole }>> {
  const target = await steps.loadTarget(targetId);
  // wouldStrandOrg reads this only when the target is an active owner, so the
  // query is skipped — not faked — for every other row.
  const activeOwners = needsOwnerCount(target) ? await steps.countActiveOwners() : 0;
  const refusal = roleChangeRefusal(actor, target, nextRole, { activeOwners });
  if (refusal || !target || !isAssignableRole(nextRole)) {
    return { status: "refused", reason: refusal ?? "unassignable_role" };
  }

  await steps.applyRole(target.id, nextRole);
  await steps.revokeSessions(target.id);

  return { status: "done", userId: target.id, from: target.role, to: nextRole };
}

/**
 * Deactivation is not a delete (AGENTS.md database rule 7, and the audit trail
 * references the profile): the row stays, `is_active` goes false, and the same
 * control puts it back.
 *
 * Reactivating lifts the ban first, so a user is never left able to sign in
 * with no working account or unable to sign in to a working one, whichever
 * step fails.
 */
export async function changeUserActive(
  steps: UserAdminSteps,
  actor: UserAdminActor,
  targetId: string,
  nextActive: boolean
): Promise<UserAdminResult<{ userId: string; isActive: boolean }>> {
  const target = await steps.loadTarget(targetId);
  const activeOwners = needsOwnerCount(target) ? await steps.countActiveOwners() : 0;
  const refusal = activeChangeRefusal(actor, target, nextActive, { activeOwners });
  if (refusal || !target) return { status: "refused", reason: refusal ?? "not_found" };

  await steps.applyActive(target.id, nextActive);
  await steps.setBanned(target.id, !nextActive);
  if (!nextActive) await steps.revokeSessions(target.id);

  return { status: "done", userId: target.id, isActive: nextActive };
}

const LOWER = "abcdefghijkmnpqrstuvwxyz"; // no l, o
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O
const DIGITS = "23456789"; // no 0, 1
const SYMBOLS = "!@#$%^&*-_=+?";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** supabase/config.toml sets minimum_password_length = 12; this clears it comfortably. */
export const GENERATED_PASSWORD_LENGTH = 20;

/** Fills a Uint32Array with cryptographically strong random values. */
export type RandomSource = (buffer: Uint32Array) => Uint32Array;

function webCrypto(buffer: Uint32Array): Uint32Array {
  return globalThis.crypto.getRandomValues(buffer);
}

/** Unbiased integer in [0, n): rejection sampling, never `value % n` on its own. */
function randomIndex(n: number, random: RandomSource): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    const v = random(buf)[0] ?? 0;
    if (v < limit) return v % n;
  }
}

function pick(alphabet: string, random: RandomSource): string {
  return alphabet.charAt(randomIndex(alphabet.length, random));
}

/**
 * A strong one-time password: 20 characters from a 69-symbol alphabet (about
 * 122 bits), with at least one lower-case letter, upper-case letter, digit and
 * symbol so it passes any character-class policy GoTrue may be configured
 * with. Look-alike characters (0/O, 1/l/I) are left out because it is read off
 * a screen and handed to someone.
 */
export function generatePassword(random: RandomSource = webCrypto): string {
  const chars = [pick(LOWER, random), pick(UPPER, random), pick(DIGITS, random), pick(SYMBOLS, random)];
  while (chars.length < GENERATED_PASSWORD_LENGTH) chars.push(pick(ALL, random));

  // Fisher-Yates, so the guaranteed classes are not always in the first four places.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);
    const tmp = chars[i] ?? "";
    chars[i] = chars[j] ?? "";
    chars[j] = tmp;
  }
  return chars.join("");
}
