"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction } from "@/lib/safe-action";
import { createAuthUser, deleteAuthUser } from "@/lib/auth/admin";
import { addUserSchema } from "./schema";
import { emailForUsername, generatePassword } from "./service";

/**
 * build/03-auth-and-rbac.md §2.10's inviteUser, reshaped by the owner
 * (2026-09-17) into Add User: a username instead of an email, and a generated
 * password shown once instead of an invite email (email is out of scope for
 * v1, and staff sign in with email + password — D48).
 *
 * Guard: adminAction — CAN.inviteUser is owner/admin, and `profiles_insert`
 * enforces the same (is_admin(), own org) on the write below.
 *
 * Two writes across two systems, so not one transaction (§2.10): the auth
 * user first, then the profile through the caller's RLS-scoped client; if the
 * profile insert fails, the auth user is deleted before the error returns.
 *
 * THE PASSWORD: generated here, sent to GoTrue (which keeps only a bcrypt
 * hash), and returned once in this action's response for the dialog to show.
 * It is never logged, never written to a table, and never part of an error.
 */
export const addUser = adminAction.inputSchema(addUserSchema).action(async ({ parsedInput, ctx }) => {
  const email = emailForUsername(parsedInput.username);
  const password = generatePassword();

  const created = await createAuthUser({ email, password });
  if (!created.ok) {
    return { status: "username_taken" as const, username: parsedInput.username };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").insert({
    id: created.userId,
    org_id: ctx.session.orgId,
    full_name: parsedInput.fullName || parsedInput.username,
    email,
    role: parsedInput.role,
  });
  if (error) {
    try {
      await deleteAuthUser(created.userId);
    } catch (cleanup) {
      // The ops reconciliation (auth.users with no profile) is the backstop.
      console.error(`[users] orphaned auth user ${created.userId} after a failed profile insert`, cleanup);
    }
    throw new Error(error.message);
  }

  revalidatePath("/users");
  return { status: "created" as const, username: parsedInput.username, email, password };
});
