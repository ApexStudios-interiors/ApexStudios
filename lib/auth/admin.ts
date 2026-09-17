import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GoTrue's admin API, and nothing else. This is the `lib/auth/admin.ts` that
 * lib/supabase/admin.ts and build/03-auth-and-rbac.md §2.10 name as the one
 * place user administration may hold the service_role client: `auth.users` is
 * not a Postgres table PostgREST exposes, so there is no RLS-scoped way to
 * create a sign-in.
 *
 * Deliberately narrow. It creates and deletes auth users and sets a
 * password — it never reads or writes an application table. The `profiles` row that gives the account an
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

/** Compensation for a failed profile or membership insert (build/03 §2.10: no orphan auth users). */
export async function deleteAuthUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`deleteAuthUser: ${error.code ?? error.status ?? "unknown"}: ${error.message}`);
}
