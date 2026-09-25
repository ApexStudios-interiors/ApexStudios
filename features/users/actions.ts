"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction, authedAction } from "@/lib/safe-action";
import {
  createAuthUser,
  deleteAuthUser,
  revokeUserSessions,
  setAuthPassword,
  setAuthUserBanned,
} from "@/lib/auth/admin";
import { ForbiddenError } from "@/lib/auth/session";
import type { Role } from "@/lib/rbac/roles";
import { insertProjectMember } from "@/features/projects/members";
import { countActiveOwners } from "./queries";
import {
  addUserSchema,
  changeMyPasswordSchema,
  createClientLoginSchema,
  resetPasswordSchema,
  setUserActiveSchema,
  setUserRoleSchema,
} from "./schema";
import {
  changeMyPassword,
  changeUserActive,
  changeUserRole,
  provisionAccount,
  resetAccountPassword,
  type ProvisionSteps,
  type UserAdminRefusal,
  type UserAdminSteps,
} from "./service";

/**
 * build/03-auth-and-rbac.md §2.10's inviteUser, reshaped by the owner
 * (2026-09-17) into Add User and Create client login: a username instead of
 * an email, and a generated password shown once instead of any email. Every
 * role signs in with username + password (D51); the app sends no auth email.
 *
 * Guard: adminAction — CAN.inviteUser / CAN.manageProjectMembers are
 * owner/admin, and `profiles_insert` / `pm_insert` enforce the same on the
 * writes below.
 *
 * Both actions share one creation path, provisionAccount (./service.ts): the
 * auth user first, then the profile through the caller's RLS-scoped client,
 * then — for a client — the project membership. If any step after the auth
 * user fails, the auth user is deleted before the error returns, and the
 * profile and membership cascade with it.
 *
 * THE PASSWORD: generated in provisionAccount, sent to GoTrue (which keeps
 * only a bcrypt hash), and returned once in the action's response for the
 * dialog to show. It is never logged, never written to a table, and never part
 * of an error.
 */

function stepsFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: { orgId: string; fullName: string; role: Role }
): ProvisionSteps {
  return {
    createAuthUser,
    deleteAuthUser,
    insertProfile: async (userId, email) => {
      const { error } = await supabase.from("profiles").insert({
        id: userId,
        org_id: profile.orgId,
        full_name: profile.fullName,
        email,
        role: profile.role,
      });
      if (error) throw new Error(error.message);
    },
    onOrphan: (userId, cleanupError) => {
      // The ops reconciliation (auth.users with no profile) is the backstop.
      console.error(`[users] orphaned auth user ${userId} after a failed account creation`, cleanupError);
    },
  };
}

export const addUser = adminAction.inputSchema(addUserSchema).action(async ({ parsedInput, ctx }) => {
  const supabase = await createClient();
  const result = await provisionAccount(
    stepsFor(supabase, {
      orgId: ctx.session.orgId,
      fullName: parsedInput.fullName || parsedInput.username,
      role: parsedInput.role,
    }),
    parsedInput.username
  );
  if (result.status === "username_taken") {
    return { status: "username_taken" as const, username: parsedInput.username };
  }

  revalidatePath("/users");
  return {
    status: "created" as const,
    username: parsedInput.username,
    email: result.email,
    password: result.password,
  };
});

/**
 * D51: a client login is created from a project, by owner/admin, and is a
 * member of that project from the moment it exists. The membership insert is
 * provisionAccount's `afterProfile` step, so a failure there (or an unknown or
 * other-org project) deletes the auth user rather than leaving a client
 * account that can sign in and see nothing.
 */
export const createClientLogin = adminAction
  .inputSchema(createClientLoginSchema)
  .action(async ({ parsedInput, ctx }) => {
    const supabase = await createClient();
    // Checked again inside insertProjectMember; this early read only avoids
    // creating and then deleting a sign-in for a project the caller cannot see.
    const { data: project, error } = await supabase
      .from("projects")
      .select("id")
      .eq("id", parsedInput.projectId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("NOT_FOUND: project");

    const steps: ProvisionSteps = {
      ...stepsFor(supabase, {
        orgId: ctx.session.orgId,
        fullName: parsedInput.fullName || parsedInput.username,
        role: "client",
      }),
      afterProfile: async (userId) => {
        await insertProjectMember(supabase, {
          projectId: parsedInput.projectId,
          profileId: userId,
          addedBy: ctx.session.userId,
        });
      },
    };

    const result = await provisionAccount(steps, parsedInput.username);
    if (result.status === "username_taken") {
      return { status: "username_taken" as const, username: parsedInput.username };
    }

    updateTag(`project:${parsedInput.projectId}`);
    revalidatePath("/users");
    revalidatePath(`/projects/${parsedInput.projectId}`, "layout");
    return {
      status: "created" as const,
      username: parsedInput.username,
      email: result.email,
      password: result.password,
    };
  });

/**
 * Reset password (D52): the only recovery path since D51 removed every
 * self-service one, and so also an account-takeover primitive. Three checks,
 * all on the server:
 *
 *  1. adminAction — the caller's REAL role (requireRole ignores the D20
 *     preview cookie) is owner or admin.
 *  2. passwordResetRefusal (./service.ts) — the target is read through the
 *     caller's RLS-scoped client, so a user in another org is simply not
 *     found; then deleted, self, admin → owner/admin, and deactivated are
 *     refused against `ctx.session.role`, never `ctx.session.impersonating`.
 *  3. rpc_record_password_reset — the database re-checks the same rule
 *     against the JWT's role and writes the audit_log row, before the
 *     password changes. If the database refuses, nothing is changed.
 *
 * Then GoTrue sets the new password and deletes every session the user has
 * (lib/auth/admin.ts setAuthPassword). The password is returned once, here,
 * and nowhere else: not logged, not in any table or audit row, not in an
 * error, and no revalidation is needed because nothing on the page changes.
 */
export const resetUserPassword = adminAction
  .inputSchema(resetPasswordSchema)
  .action(async ({ parsedInput, ctx }) => {
    const supabase = await createClient();
    const result = await resetAccountPassword(
      {
        loadTarget: async (userId) => {
          const { data, error } = await supabase
            .from("profiles")
            .select("id, role, is_active, deleted_at, email")
            .eq("id", userId)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return data
            ? {
                id: data.id,
                role: data.role,
                isActive: data.is_active,
                deletedAt: data.deleted_at,
                email: data.email,
              }
            : null;
        },
        recordReset: async (userId) => {
          const { error } = await supabase.rpc("rpc_record_password_reset", { p_target_id: userId });
          // The RPC raises "FORBIDDEN: …" / "NOT_FOUND: …", which mapDomainError
          // turns into user copy. Its messages never carry a password.
          if (error) throw new Error(error.message);
        },
        setAuthPassword,
      },
      // The REAL role. ctx.session.impersonating is deliberately not consulted.
      { userId: ctx.session.userId, role: ctx.session.role },
      parsedInput.userId
    );

    if (result.status === "refused") {
      if (result.reason === "not_found") throw new Error("NOT_FOUND: user");
      throw new ForbiddenError(`resetUserPassword: ${result.reason}`);
    }

    return {
      status: "reset" as const,
      username: result.username,
      email: result.email,
      password: result.password,
    };
  });

/**
 * Change a user's role, and deactivate / reactivate a user — the two controls
 * the Users page rendered disabled until now.
 *
 * Checked, as the reset is, three times on the server:
 *
 *  1. adminAction — the caller's REAL role (the D20 preview cookie is never
 *     consulted) is owner or admin.
 *  2. roleChangeRefusal / activeChangeRefusal (./service.ts) against the
 *     target as read through the caller's own RLS-scoped client, so a user in
 *     another org is simply not found.
 *  3. The database, in the same statement that performs the change:
 *     rpc_set_user_role / rpc_set_user_active update the row, and the
 *     trg_profiles_privilege_guard trigger on `profiles` re-checks the rule
 *     and the last-active-owner invariant while holding the relevant rows.
 *     That trigger also covers a direct PostgREST PATCH, which no RPC could.
 *
 * THEN the user's sessions end. A JWT carries app_role until it expires and
 * RLS trusts that claim, so a demotion whose sessions survive it is not yet in
 * force; a deactivation additionally bans the GoTrue account, because
 * `is_active` is an application column GoTrue would otherwise let the user
 * sign straight back in past. See lib/auth/admin.ts for what each one does and
 * for the ~30-minute PostgREST window neither of them can close.
 */
function userAdminSteps(supabase: Awaited<ReturnType<typeof createClient>>): UserAdminSteps {
  return {
    loadTarget: async (userId) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, is_active, deleted_at")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data
        ? { id: data.id, role: data.role, isActive: data.is_active, deletedAt: data.deleted_at }
        : null;
    },
    countActiveOwners,
    applyRole: async (userId, role) => {
      const { error } = await supabase.rpc("rpc_set_user_role", { p_target_id: userId, p_role: role });
      // The RPC and its trigger raise "FORBIDDEN: …" / "NOT_FOUND: …" /
      // "ILLEGAL_TRANSITION: …", which mapDomainError turns into user copy.
      if (error) throw new Error(error.message);
    },
    applyActive: async (userId, isActive) => {
      const { error } = await supabase.rpc("rpc_set_user_active", {
        p_target_id: userId,
        p_active: isActive,
      });
      if (error) throw new Error(error.message);
    },
    revokeSessions: async (userId) => {
      await revokeUserSessions(userId);
    },
    setBanned: setAuthUserBanned,
  };
}

/** A refusal the server made; the same reasons the page uses to disable a control. */
function refuse(action: string, reason: UserAdminRefusal): never {
  if (reason === "not_found") throw new Error("NOT_FOUND: user");
  if (reason === "no_change") throw new Error("ILLEGAL_TRANSITION: nothing to change");
  throw new ForbiddenError(`${action}: ${reason}`);
}

export const setUserRole = adminAction.inputSchema(setUserRoleSchema).action(async ({ parsedInput, ctx }) => {
  const supabase = await createClient();
  const result = await changeUserRole(
    userAdminSteps(supabase),
    // The REAL role. ctx.session.impersonating is deliberately not consulted.
    { userId: ctx.session.userId, role: ctx.session.role },
    parsedInput.userId,
    parsedInput.role
  );
  if (result.status === "refused") refuse("setUserRole", result.reason);

  revalidatePath("/users");
  return { status: "changed" as const, role: result.to };
});

/**
 * Change my password — every signed-in role, their own account only.
 *
 * `authedAction`, not `adminAction`: a site supervisor and a client have the
 * same right to their own password as the owner. There is no target id in the
 * input at all, so this action cannot be aimed at anyone else; it acts through
 * the caller's own RLS-scoped Supabase client, which holds no service_role key
 * and no GoTrue admin API.
 *
 * VERIFYING THE CURRENT PASSWORD. GoTrue exposes no "check this password"
 * endpoint, and `secure_password_change` is off in supabase/config.toml, so
 * `updateUser({ password })` on its own would let anyone at an unlocked laptop
 * take the account. The check is therefore a real re-authentication:
 * `signInWithPassword` with the session's own email and the typed current
 * password. It succeeds only for the same account (the email is the session's,
 * never the browser's), and it issues a fresh session for this browser, which
 * @supabase/ssr writes back over the current cookies.
 *
 * SESSIONS. GoTrue's user-scoped update calls `UpdatePassword(tx, sessionID)`
 * with the CURRENT session id, which logs out every session except this one
 * (models.LogoutAllExceptMe) — unlike the admin reset in lib/auth/admin.ts,
 * which passes nil and ends them all. So the caller stays signed in here and
 * is signed out everywhere else, which is what the dialog says. If a future
 * GoTrue were to end this session too, the next navigation simply fails
 * app/(app)/layout.tsx's session check and redirects to /login — the dialog's
 * own success state does not depend on the session surviving.
 *
 * Neither password is logged, returned, or placed in any error: the refusal is
 * a reason code, and a thrown error is the failing step's own.
 */
export const changeMyPasswordAction = authedAction
  .inputSchema(changeMyPasswordSchema)
  .action(async ({ parsedInput, ctx }) => {
    const supabase = await createClient();
    const result = await changeMyPassword(
      {
        verifyCurrentPassword: async (email, password) => {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          return !error;
        },
        setOwnPassword: async (password) => {
          const { error } = await supabase.auth.updateUser({ password });
          // GoTrue's code, never the input — the input is the password.
          if (error) throw new Error(`updateOwnPassword: ${error.code ?? error.status ?? "unknown"}`);
        },
      },
      { email: ctx.session.email },
      { currentPassword: parsedInput.currentPassword, newPassword: parsedInput.newPassword }
    );

    if (result.status === "refused") return { status: "refused" as const, reason: result.reason };
    return { status: "changed" as const };
  });

export const setUserActive = adminAction
  .inputSchema(setUserActiveSchema)
  .action(async ({ parsedInput, ctx }) => {
    const supabase = await createClient();
    const result = await changeUserActive(
      userAdminSteps(supabase),
      { userId: ctx.session.userId, role: ctx.session.role },
      parsedInput.userId,
      parsedInput.isActive
    );
    if (result.status === "refused") refuse("setUserActive", result.reason);

    revalidatePath("/users");
    return { status: "changed" as const, isActive: result.isActive };
  });
