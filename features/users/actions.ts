"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction } from "@/lib/safe-action";
import { createAuthUser, deleteAuthUser } from "@/lib/auth/admin";
import type { Role } from "@/lib/rbac/roles";
import { insertProjectMember } from "@/features/projects/members";
import { addUserSchema, createClientLoginSchema } from "./schema";
import { provisionAccount, type ProvisionSteps } from "./service";

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
