"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction } from "@/lib/safe-action";
import { createAuthUser, deleteAuthUser, setAuthPassword } from "@/lib/auth/admin";
import { ForbiddenError } from "@/lib/auth/session";
import type { Role } from "@/lib/rbac/roles";
import { insertProjectMember } from "@/features/projects/members";
import { addUserSchema, createClientLoginSchema, resetPasswordSchema } from "./schema";
import { provisionAccount, resetAccountPassword, type ProvisionSteps } from "./service";

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
