"use server";

import "server-only";
import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { adminAction, authedAction } from "@/lib/safe-action";
import { createClient } from "@/lib/supabase/server";
import { encodePreviewCookie, PREVIEW_COOKIE_NAME, PREVIEW_ROLES } from "@/lib/auth/impersonation";
import { ForbiddenError } from "@/lib/auth/session";

/**
 * D20. Read the module doc on lib/auth/session.ts's `impersonating` field
 * first: this cookie only ever WIDENS what a read query is shaped for. It is
 * never consulted by requireRole/requireProjectAccess, so a write path cannot
 * be fooled by it — adminAction below checks the REAL session role, exactly
 * like every other guarded action, before it will even start a preview.
 */
const startSchema = z.object({
  role: z.enum(PREVIEW_ROLES),
  // Mock AppContext project id today; a real uuid once Build 04 lands. See
  // the migration's own comment for why this is text, not a project FK.
  projectId: z.string().min(1),
});

export const startPreview = adminAction.inputSchema(startSchema).action(async ({ parsedInput, ctx }) => {
  // Previewing as Admin is the OWNER's alone. Checked here, against the REAL
  // session role (adminAction's requireRole ignores the preview cookie), not
  // merely by which entries the sidebar renders — an admin previewing as admin
  // gains nothing but would put an admin-shaped view behind a preview banner
  // that says a write will be refused, and no lesser role may reach it at all.
  // For the owner this is a narrowing: CAN (lib/rbac/permissions.ts) gives
  // `admin` no capability `owner` lacks, so the previewed reads are a subset.
  if (parsedInput.role === "admin" && ctx.session.role !== "owner") {
    throw new ForbiddenError("startPreview: previewing as admin is owner-only");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_log_impersonation", {
    p_action: "start",
    p_previewed_role: parsedInput.role,
    p_project_ref: parsedInput.projectId,
  });
  if (error) throw new Error("Could not start preview.");

  const cookie = encodePreviewCookie(parsedInput.role, parsedInput.projectId);
  const cookieStore = await cookies();
  cookieStore.set(cookie.name, cookie.value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: cookie.maxAge,
    path: "/",
  });

  revalidatePath("/", "layout");
  return { ok: true as const };
});

export const stopPreview = authedAction.action(async ({ ctx }) => {
  if (ctx.session.impersonating) {
    const supabase = await createClient();
    await supabase.rpc("rpc_log_impersonation", {
      p_action: "stop",
      p_previewed_role: ctx.session.impersonating.role,
      p_project_ref: ctx.session.impersonating.projectId,
    });
  }
  const cookieStore = await cookies();
  cookieStore.delete(PREVIEW_COOKIE_NAME);
  revalidatePath("/", "layout");
  return { ok: true as const };
});
