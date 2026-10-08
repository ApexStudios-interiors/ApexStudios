import "server-only";
import type { Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { EditDailyUpdateInput, PostDailyUpdateInput } from "./schema";

/**
 * Posting and editing a daily update, once, for every caller — the web's
 * `postDailyUpdate` / `editDailyUpdate` actions (./actions.ts) and the
 * mobile API. Both authenticate, check the role (admin/site) and validate
 * (postDailyUpdateSchema / editDailyUpdateSchema) first; this does the
 * writes on the caller's own RLS-scoped client, where everything real is
 * enforced: du_insert (member, admin/site, own author_id, own org),
 * trg_daily_updates_ancestry (package in this project), du_update_author
 * (the author, within 24 hours) and trg_daily_updates_body_only (an edit
 * changes the body only).
 *
 * Errors are thrown as `Error(message)` exactly as before, so each caller's
 * existing error mapping (mapDomainError) applies unchanged. No caching or
 * revalidation here — that is the web action's concern.
 */

/**
 * `input.id` is the client-generated update id (schema.ts explains why):
 * the photos were uploaded and confirmed against it before this row exists.
 * Each attachment is re-checked to really be one of this session's own
 * uploads for this exact project and update, not a stray id pointing at
 * someone else's file.
 */
export async function postDailyUpdateFor(
  session: Session,
  input: PostDailyUpdateInput
): Promise<{ id: string }> {
  const { id, projectId, packageId, updateDate, body, attachmentIds } = input;
  const supabase = await createClient();

  if (attachmentIds.length > 0) {
    const { data: owned, error: attErr } = await supabase
      .from("attachments")
      .select("id")
      .in("id", attachmentIds)
      .eq("entity_type", "daily_update")
      .eq("entity_id", id)
      .eq("project_id", projectId)
      .eq("uploaded_by", session.userId)
      .is("deleted_at", null);
    if (attErr) throw new Error(attErr.message);
    if ((owned?.length ?? 0) !== attachmentIds.length) {
      throw new Error("NOT_FOUND: one or more photos did not upload correctly — please retry them");
    }
  }

  const { error } = await supabase.from("daily_updates").insert({
    id,
    org_id: session.orgId,
    project_id: projectId,
    package_id: packageId,
    update_date: updateDate,
    body,
    author_id: session.userId,
    created_by: session.userId,
  });
  // The id is the caller's (schema.ts), so a retry of a post that already
  // succeeded — a lost response, a second tap — meets daily_updates_pkey.
  // That is "already posted", not an unexpected failure: the domain
  // ILLEGAL_TRANSITION (409 on mobile), never a second update.
  if (error?.code === "23505" && error.message.includes("daily_updates_pkey")) {
    throw new Error("ILLEGAL_TRANSITION: this daily update has already been posted");
  }
  if (error) throw new Error(error.message);

  return { id };
}

/**
 * Body text only, with the caller as `updated_by` — nothing else is ever
 * sent. Who may edit, and until when, is du_update_author's decision: a row
 * it refuses is simply excluded rather than raising, so "no row came back"
 * is reported as a clean error, not a silent no-op. `projectId` is returned
 * for the caller's own cache refresh.
 */
export async function editDailyUpdateFor(
  session: Session,
  input: EditDailyUpdateInput
): Promise<{ id: string; projectId: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_updates")
    .update({ body: input.body, updated_by: session.userId })
    .eq("id", input.id)
    .select("id, project_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("ILLEGAL_TRANSITION: this update can no longer be edited");

  return { id: data.id, projectId: data.project_id };
}
