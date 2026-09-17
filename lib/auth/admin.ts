import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GoTrue's admin API, and nothing else. This is the `lib/auth/admin.ts` that
 * lib/supabase/admin.ts and build/03-auth-and-rbac.md §2.10 name as the one
 * place user administration may hold the service_role client: `auth.users` is
 * not a Postgres table PostgREST exposes, so there is no RLS-scoped way to
 * create a sign-in.
 *
 * Deliberately narrow. It creates and deletes auth users, sets a password,
 * bans and unbans an account, and ends a user's sessions — every one of those
 * lives in GoTrue's own tables, and none of them reads or writes an
 * application table. The `profiles` row that gives the account an
 * org and a role is inserted by the caller through the user's own RLS-scoped
 * client, so `profiles_insert` (org_id = auth_org() and is_admin()) still
 * decides who may add whom.
 *
 * Nothing here logs. A password passes through createAuthUser on its way to
 * GoTrue, which stores only its bcrypt hash.
 */

export type CreateAuthUserResult = { ok: true; userId: string } | { ok: false; reason: "email_exists" };

export async function createAuthUser(input: {
  email: string;
  password: string;
}): Promise<CreateAuthUserResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    // Every role signs in with username + password (D51); the derived address
    // is not a mailbox anyone confirms, so it is created already confirmed and
    // no email is ever sent to it.
    email_confirm: true,
  });
  if (error) {
    if (error.code === "email_exists" || error.code === "user_already_exists") {
      return { ok: false, reason: "email_exists" };
    }
    // GoTrue's message, never the input — the input carries the password.
    throw new Error(`createAuthUser: ${error.code ?? error.status ?? "unknown"}: ${error.message}`);
  }
  return { ok: true, userId: data.user.id };
}

/**
 * Reset password (D52). PUT /admin/users/{id} with a password. In the same
 * transaction as the password change, GoTrue deletes EVERY auth.sessions row
 * the user has (models.User.UpdatePassword(tx, nil) → models.Logout, which is
 * `DELETE FROM sessions WHERE user_id = ?`; refresh_tokens cascade on
 * session_id). So no refresh token survives, and any request carrying an
 * outstanding access token fails middleware.ts's getUser(), which GoTrue
 * rejects with session_not_found once the session row is gone.
 *
 * auth.admin.signOut is not used: it takes the user's JWT, not a user id.
 */
export async function setAuthPassword(userId: string, password: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  // GoTrue's code and message, never the input — the input is the password.
  if (error) throw new Error(`setAuthPassword: ${error.code ?? error.status ?? "unknown"}: ${error.message}`);
}

/**
 * Ends every session the user holds, without touching their password.
 *
 * There is no GoTrue admin endpoint that signs a user out by id —
 * `auth.admin.signOut` takes that user's own JWT, which a server acting on
 * someone else never has — and the one thing that reliably ends every session,
 * a password change (setAuthPassword above), is the wrong tool for a demotion:
 * it would also lock the user out of an account they are meant to keep using.
 *
 * So the rows go directly, through `rpc_revoke_user_sessions` (migration
 * 20260918090001), which is `security definer`, granted to `service_role`
 * alone, and deletes the user's `auth.sessions` rows; `auth.refresh_tokens`
 * cascades on `session_id`. Two things then happen:
 *
 *  - the browser's next token refresh finds no refresh-token row and the
 *    session ends;
 *  - middleware.ts's `getUser()` is rejected even while the current access
 *    token is unexpired, because GoTrue looks up the session named by the
 *    JWT's `session_id` claim and returns 403 `session_not_found` when it is
 *    gone (supabase/auth `internal/api/auth.go`).
 *
 * What it cannot do is invalidate an access token at PostgREST, which checks
 * the signature and `exp` and consults no session table. That window is
 * bounded by `jwt_expiry` (supabase/config.toml: 1800s).
 *
 * Returns how many sessions were deleted — zero is normal (the user may not
 * have been signed in), not a failure.
 */
export async function revokeUserSessions(userId: string): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("rpc_revoke_user_sessions", { p_user_id: userId });
  if (error) {
    throw new Error(`revokeUserSessions: ${error.code ?? "unknown"}: ${error.message}`);
  }
  return data ?? 0;
}

/**
 * A ban far enough out to be permanent; lifted by `setAuthUserBanned(id, false)`.
 * GoTrue parses a Go duration string, so this is 100 years in hours.
 */
const BAN_DURATION = "876000h";

/**
 * Bans or unbans the account, which is what makes `profiles.is_active` mean
 * anything to GoTrue. `is_active` lives in an application table GoTrue knows
 * nothing about, so a deactivated user who was never banned could simply sign
 * in again and hold a fresh, valid token for as long as they liked — the app
 * would refuse them (lib/auth/session.ts returns no session for an inactive
 * profile, and app/(app)/layout.tsx redirects), but PostgREST would not.
 *
 * A banned user is refused at the password grant ("User is banned",
 * supabase/auth `internal/api/token.go`) and at the refresh-token grant
 * ("Invalid Refresh Token: User Banned", `internal/tokens/service.go`), so no
 * new token can be minted for them by either route.
 */
export async function setAuthUserBanned(userId: string, banned: boolean): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: banned ? BAN_DURATION : "none",
  });
  if (error) {
    throw new Error(`setAuthUserBanned: ${error.code ?? error.status ?? "unknown"}: ${error.message}`);
  }
}

/** Compensation for a failed profile or membership insert (build/03 §2.10: no orphan auth users). */
export async function deleteAuthUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`deleteAuthUser: ${error.code ?? error.status ?? "unknown"}: ${error.message}`);
}
