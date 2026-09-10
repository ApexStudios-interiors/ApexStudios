"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { siteAction } from "@/lib/safe-action";
import { requireSession } from "@/lib/auth/session";
import { editDailyUpdateSchema, postDailyUpdateSchema } from "./schema";

/**
 * build/06-files-jobs-daily-updates.md §4.1. `postDailyUpdate`'s attachments
 * are already-confirmed rows (features/attachments/actions.ts's
 * `confirmUpload`, called from `FileUploader` before this ever runs) tagged
 * with THIS update's own client-generated id — the re-check below confirms
 * each one really is one of this session's own uploads for this exact
 * project and update, not a stray id pointing at someone else's file.
 */

export const postDailyUpdate = siteAction
  .inputSchema(postDailyUpdateSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { id, projectId, packageId, updateDate, body, attachmentIds } = parsedInput;
    const supabase = await createClient();

    if (attachmentIds.length > 0) {
      const { data: owned, error: attErr } = await supabase
        .from("attachments")
        .select("id")
        .in("id", attachmentIds)
        .eq("entity_type", "daily_update")
        .eq("entity_id", id)
        .eq("project_id", projectId)
        .eq("uploaded_by", ctx.session.userId)
        .is("deleted_at", null);
      if (attErr) throw new Error(attErr.message);
      if ((owned?.length ?? 0) !== attachmentIds.length) {
        throw new Error("NOT_FOUND: one or more photos did not upload correctly — please retry them");
      }
    }

    const { error } = await supabase.from("daily_updates").insert({
      id,
      org_id: ctx.session.orgId,
      project_id: projectId,
      package_id: packageId,
      update_date: updateDate,
      body,
      author_id: ctx.session.userId,
      created_by: ctx.session.userId,
    });
    if (error) throw new Error(error.message);

    updateTag(`project:${projectId}`);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { id };
  });

export const editDailyUpdate = siteAction
  .inputSchema(editDailyUpdateSchema)
  .action(async ({ parsedInput, ctx }) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("daily_updates")
      .update({ body: parsedInput.body, updated_by: ctx.session.userId })
      .eq("id", parsedInput.id)
      .select("id, project_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    // RLS's du_update_author (author + within 24 hours) simply excludes a row
    // it refuses rather than raising — a clean error here, not a silent no-op.
    if (!data) throw new Error("ILLEGAL_TRANSITION: this update can no longer be edited");

    updateTag(`project:${data.project_id}`);
    revalidatePath(`/projects/${data.project_id}`, "layout");
    return { id: data.id };
  });

/** `PostUpdateDialog`'s Package dropdown — `v_package_site` for non-admin,
 *  same reason as every other admin-only-table lookup this build's own
 *  queries.ts already routes that way (Build 04/05's repeated finding). */
export async function getPackageOptions(projectId: string): Promise<{ id: string; name: string }[]> {
  const session = await requireSession();
  const supabase = await createClient();
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";

  if (isAdmin) {
    const { data, error } = await supabase
      .from("packages")
      .select("id, name, seq_no")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("seq_no", { ascending: true });
    if (error) throw new Error(error.message);
    return data;
  }
  const { data, error } = await supabase
    .from("v_package_site")
    .select("id, name, seq_no")
    .eq("project_id", projectId)
    .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);
  return data.filter(
    (p): p is { id: string; name: string; seq_no: number } => p.id != null && p.name != null
  );
}
