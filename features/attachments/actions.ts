"use server";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess, requireSession } from "@/lib/auth/session";
import { authedAction } from "@/lib/safe-action";
import { enqueue } from "@/lib/jobs/enqueue";
import { buildAttachmentKey, keyBelongsTo } from "@/lib/r2/keys";
import { headObject } from "@/lib/r2/head";
import { presignGet, presignPut } from "@/lib/r2/presign";
import { isAllowedMime, maxBytesFor, MAX_PHOTOS_PER_ENTITY } from "@/lib/r2/constraints";
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
 */

export const requestUploadUrl = authedAction
  .inputSchema(requestUploadUrlSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, entityType, entityId, fileName, mimeType, sizeBytes } = parsedInput;

    await requireProjectAccess(ctx.session, projectId);

    // Server-side, not the client's `accept` attribute (build's own warning:
    // "a convenience, not a control").
    if (!isAllowedMime(mimeType)) {
      throw new Error(`REASON_REQUIRED: ${mimeType} is not an allowed file type`);
    }
    const maxBytes = maxBytesFor(mimeType);
    if (sizeBytes > maxBytes) {
      throw new Error(`REASON_REQUIRED: file exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`);
    }

    const supabase = await createClient();
    const { count, error: countError } = await supabase
      .from("attachments")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .is("deleted_at", null);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= MAX_PHOTOS_PER_ENTITY) {
      throw new Error(`REASON_REQUIRED: this ${entityType} already has ${MAX_PHOTOS_PER_ENTITY} attachments`);
    }

    const key = buildAttachmentKey({ orgId: ctx.session.orgId, projectId, entityType, entityId, fileName });
    const url = await presignPut(key, mimeType);

    // No `attachments` row yet — build §2.2's own reason for the two-step flow:
    // "we record only what we can verify", and nothing has been verified yet.
    return { url, key };
  });

export const confirmUpload = authedAction
  .inputSchema(confirmUploadSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { key, projectId, entityType, entityId, fileName, mimeType, sizeBytes } = parsedInput;

    await requireProjectAccess(ctx.session, projectId);

    // A key is user-supplied input — re-derive and re-check it, never trust it.
    if (!keyBelongsTo(key, ctx.session.orgId, projectId)) {
      throw new Error("FORBIDDEN: that key does not belong to this project");
    }

    const head = await headObject(key);
    if (!head.exists) {
      throw new Error("NOT_FOUND: that upload never completed");
    }
    if (head.sizeBytes !== sizeBytes) {
      throw new Error("REASON_REQUIRED: the uploaded file size does not match what was declared");
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("attachments")
      .insert({
        org_id: ctx.session.orgId,
        project_id: projectId,
        entity_type: entityType,
        entity_id: entityId,
        r2_key: key,
        file_name: fileName,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        uploaded_by: ctx.session.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await enqueue("attachment.thumbnail", { attachmentId: data.id }, { idempotencyKey: data.id });

    return { id: data.id };
  });

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
