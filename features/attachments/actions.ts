"use server";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess, requireSession } from "@/lib/auth/session";
import { authedAction } from "@/lib/safe-action";
import { presignGet } from "@/lib/r2/presign";
import { confirmUploadFor, requestUploadFor } from "./upload";
import {
  confirmUploadSchema,
  deleteAttachmentSchema,
  getDownloadUrlSchema,
  requestUploadUrlSchema,
} from "./schema";

/**
 * build/06-files-jobs-daily-updates.md §2.2, in full. `authedAction`, not a
 * role-guarded one: every role that can reach an entity with attachments
 * (a client viewing an approval's photos, for one) needs `getDownloadUrl` at
 * least, and narrowing who may upload is `requireProjectAccess` plus each
 * entity's own RLS, not a blanket role check here.
 *
 * The upload pair's work — checks, signing, the HeadObject re-check, the row,
 * the thumbnail job — lives in ./upload.ts, shared with the mobile API.
 */

export const requestUploadUrl = authedAction
  .inputSchema(requestUploadUrlSchema)
  .action(async ({ parsedInput, ctx }) => requestUploadFor(ctx.session, parsedInput));

export const confirmUpload = authedAction
  .inputSchema(confirmUploadSchema)
  .action(async ({ parsedInput, ctx }) => confirmUploadFor(ctx.session, parsedInput));

export const getDownloadUrl = authedAction
  .inputSchema(getDownloadUrlSchema)
  .action(async ({ parsedInput, ctx }) => {
    const supabase = await createClient();
    const { data: attachment, error } = await supabase
      .from("attachments")
      .select("id, r2_key, project_id, mime_type")
      .eq("id", parsedInput.attachmentId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!attachment) throw new Error("NOT_FOUND: that attachment no longer exists");

    if (attachment.project_id) {
      await requireProjectAccess(ctx.session, attachment.project_id);
    }

    const isImage = attachment.mime_type.startsWith("image/");
    // 15-minute TTL (build §2.2). Never stored or cached — a fresh URL every call.
    const url = await presignGet(attachment.r2_key, isImage ? undefined : "attachment");
    return { url };
  });

/** `FileUploader`'s thumbnail source — a presigned GET for the small object
 *  under `thumb/`, falling back to the full object if the thumbnail job
 *  hasn't run yet (build §2.4). Plain function, not a next-safe-action
 *  action: it's a read a Server Component calls directly per row, not a
 *  form-driven mutation. */
export async function getThumbnailUrl(attachmentId: string): Promise<string | null> {
  await requireSession();
  const supabase = await createClient();
  const { data: attachment, error } = await supabase
    .from("attachments")
    .select("r2_key, thumb_r2_key, mime_type")
    .eq("id", attachmentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!attachment || !attachment.mime_type.startsWith("image/")) return null;

  const objectPath = attachment.thumb_r2_key ?? attachment.r2_key;
  return presignGet(objectPath);
}

/**
 * Drops one attachment row when the user removes a file from a form before
 * the form itself is saved.
 *
 * Why a real DELETE and not `deleted_at`: `requestUploadUrl` above counts
 * every row for the entity with `deleted_at is null` against
 * `MAX_PHOTOS_PER_ENTITY`, and `attachments` has no UPDATE policy — so a
 * removed-but-kept row permanently consumed one of the four slots and the
 * next upload to that entity was refused with "already has N attachments".
 * `att_delete_uploader` is the policy written for exactly this case: the
 * uploader may delete their own row within 24 hours.
 *
 * Runs on the user's own client, never the admin one, so RLS is the decision
 * and this action cannot delete a row the caller could not delete for
 * themselves.
 *
 * It does NOT throw when nothing is deleted. Three ways that happens, all of
 * them ending in the state the caller wanted:
 *   - the row is already gone;
 *   - the row is older than 24 hours, so `att_delete_uploader` no longer
 *     matches and the delete silently affects zero rows;
 *   - the row belongs to an approval that has since been decided or deleted,
 *     which the same policy freezes.
 * The caller is a form removing a tile and must not be blocked by any of
 * them — the cost of a miss is one leaked slot, not a broken form.
 *
 * The R2 object is left behind deliberately. It is now unreferenced, which is
 * precisely what `attachment.orphan_sweep` collects (it reads every
 * `attachments` row's `r2_key`/`thumb_r2_key` and deletes any object older
 * than 24 hours that no row names) — the same path a cancelled dialog's
 * uploads already take.
 */
export const deleteAttachment = authedAction
  .inputSchema(deleteAttachmentSchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("attachments")
      .delete()
      .eq("id", parsedInput.attachmentId)
      .select("id");
    // A transport or database error is worth surfacing; "no row matched" is
    // not an error and is reported as `deleted: false` instead.
    if (error) throw new Error(error.message);
    return { deleted: (data ?? []).length > 0 };
  });
