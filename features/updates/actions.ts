"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { siteAction } from "@/lib/safe-action";
import { requireSession } from "@/lib/auth/session";
import { editDailyUpdateSchema, postDailyUpdateSchema } from "./schema";
import { editDailyUpdateFor, postDailyUpdateFor } from "./write";

/**
 * build/06-files-jobs-daily-updates.md §4.1. Guard (admin/site), parse,
 * delegate, revalidate. The writes — the attachment-ownership re-check, the
 * insert, the body-only edit — live in ./write.ts, shared with the mobile API
 * so both write paths behave identically.
 */

export const postDailyUpdate = siteAction
  .inputSchema(postDailyUpdateSchema)
  .action(async ({ parsedInput, ctx }) => {
    const posted = await postDailyUpdateFor(ctx.session, parsedInput);

    updateTag(`project:${parsedInput.projectId}`);
    revalidatePath(`/projects/${parsedInput.projectId}`, "layout");
    return { id: posted.id };
  });

export const editDailyUpdate = siteAction
  .inputSchema(editDailyUpdateSchema)
  .action(async ({ parsedInput, ctx }) => {
    const edited = await editDailyUpdateFor(ctx.session, parsedInput);

    updateTag(`project:${edited.projectId}`);
    revalidatePath(`/projects/${edited.projectId}`, "layout");
    return { id: edited.id };
  });

/** `PostUpdateDialog`'s Package dropdown — `v_package_site` for non-admin,
 *  same reason as every other admin-only-table lookup this build's own
 *  queries.ts already routes that way (Build 04/05's repeated finding). */
export async function getPackageOptions(projectId: string): Promise<{ id: string; name: string }[]> {
  const session = await requireSession();
  const supabase = await createClient();
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "admin";

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
