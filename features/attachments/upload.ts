import "server-only";
import type { Session } from "@/lib/auth/session";
import { ForbiddenError, requireProjectAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { enqueue } from "@/lib/jobs/enqueue";
import { buildAttachmentKey, keyBelongsTo } from "@/lib/r2/keys";
import { headObject } from "@/lib/r2/head";
import { presignPut } from "@/lib/r2/presign";
import { isAllowedMime, maxBytesFor, MAX_PHOTOS_PER_ENTITY } from "@/lib/r2/constraints";
import type { ConfirmUploadInput, RequestUploadUrlInput } from "./schema";

/**
 * The two server halves of an upload (build/06-files-jobs-daily-updates.md
 * §2.2), once, for every caller — the web's `requestUploadUrl` /
 * `confirmUpload` actions (./actions.ts) and the mobile API. Each caller
 * authenticates and validates (requestUploadUrlSchema / confirmUploadSchema)
 * first; the mobile routes also force the entity from the URL.
 *
 *   requestUploadFor → the client PUTs the file straight to R2 → confirmUploadFor
 *
 * Everything real is enforced here and in the database: project access, the
 * allowed types and sizes (lib/r2/constraints), the per-entity cap, the key
 * re-check, the HeadObject size check, att_insert and — for daily updates —
 * trg_attachments_daily_update (author, project, draft owner, four photos,
 * race-safe). Errors are thrown as `Error(message)`, so each caller's
 * mapDomainError applies unchanged.
 */

export async function requestUploadFor(
  session: Session,
  input: RequestUploadUrlInput
): Promise<{ url: string; key: string }> {
  const { projectId, entityType, entityId, fileName, mimeType, sizeBytes } = input;

  // A daily update's photos are posted with it, and only admin/site post
  // one (du_insert). Refused here, before any URL is signed, so a client
  // cannot even put an object in the bucket for one; the database refuses
  // the attachment row too (trg_attachments_daily_update). The REAL role,
  // as every write decision. Other entity types are unchanged.
  if (entityType === "daily_update" && session.role !== "admin" && session.role !== "site") {
    throw new ForbiddenError("only admin or site may add photos to a daily update");
  }

  await requireProjectAccess(session, projectId);

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

  const key = buildAttachmentKey({ orgId: session.orgId, projectId, entityType, entityId, fileName });
  const url = await presignPut(key, mimeType);

  // No `attachments` row yet — build §2.2's own reason for the two-step flow:
  // "we record only what we can verify", and nothing has been verified yet.
  return { url, key };
}

export async function confirmUploadFor(session: Session, input: ConfirmUploadInput): Promise<{ id: string }> {
  const { key, projectId, entityType, entityId, fileName, mimeType, sizeBytes } = input;

  await requireProjectAccess(session, projectId);

  // A key is user-supplied input — re-derive and re-check it, never trust it.
  if (!keyBelongsTo(key, session.orgId, projectId)) {
    throw new Error("FORBIDDEN: that key does not belong to this project");
  }
  // …and the object must have been signed for THIS entity: requestUploadFor
  // always builds `…/{entityType}/{entityId}/…`, so a key for one record can
  // never be recorded against another.
  if (!key.startsWith(`org/${session.orgId}/project/${projectId}/${entityType}/${entityId}/`)) {
    throw new Error("FORBIDDEN: that key does not belong to this record");
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
      org_id: session.orgId,
      project_id: projectId,
      entity_type: entityType,
      entity_id: entityId,
      r2_key: key,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      uploaded_by: session.userId,
    })
    .select("id")
    .single();
  // The same key confirmed twice — a retry after a lost response. Keys are
  // unique per signed upload, so if the row already recorded is this user's,
  // for this record, that IS the answer: return it (its thumbnail job was
  // enqueued the first time). Anything else is a conflict, never a second row.
  if (error?.code === "23505" && error.message.includes("attachments_r2_key_key")) {
    const { data: existing, error: lookupError } = await supabase
      .from("attachments")
      .select("id")
      .eq("r2_key", key)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .eq("project_id", projectId)
      .eq("uploaded_by", session.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (existing) return { id: existing.id };
    throw new Error("ILLEGAL_TRANSITION: that upload has already been recorded");
  }
  if (error) throw new Error(error.message);

  await enqueue("attachment.thumbnail", { attachmentId: data.id }, { idempotencyKey: data.id });

  return { id: data.id };
}
