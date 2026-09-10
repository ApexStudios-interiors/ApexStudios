import { z } from "zod";
import { DOC_MIME, IMAGE_MIME } from "@/lib/r2/constraints";

/** build/06-files-jobs-daily-updates.md §2.2. Shared by requestUploadUrl and
 *  confirmUpload — both need to know what entity a file belongs to. */
export const attachmentEntitySchema = z.enum([
  "approval",
  "daily_update",
  "bill",
  "stock_request",
  "project",
]);

const allowedMimeSchema = z.enum([...IMAGE_MIME, ...DOC_MIME]);

/**
 * `projectId` is explicit here, deviating from the build file's own shorthand
 * (`{ entityType, entityId, fileName, mimeType, sizeBytes }`): a daily
 * update's photos upload BEFORE the update itself exists (`postDailyUpdate`
 * takes already-confirmed attachment ids, so the upload has to happen
 * first), which means `entityId` is a client-generated id for a row that
 * isn't there yet — there is nothing in the database yet to derive a project
 * from. The client already knows which project it's posting to; this just
 * says so explicitly instead of asking the server to infer it from a row
 * that doesn't exist. `confirmUpload` re-derives and re-checks it against
 * the key regardless (build §2.2's own rule: a key is user-supplied input).
 */
export const requestUploadUrlSchema = z.object({
  projectId: z.uuid(),
  entityType: attachmentEntitySchema,
  entityId: z.uuid(),
  fileName: z.string().trim().min(1).max(300),
  mimeType: allowedMimeSchema,
  sizeBytes: z.coerce.number().int().positive(),
});
export type RequestUploadUrlInput = z.infer<typeof requestUploadUrlSchema>;

export const confirmUploadSchema = z.object({
  key: z.string().trim().min(1),
  projectId: z.uuid(),
  entityType: attachmentEntitySchema,
  entityId: z.uuid(),
  fileName: z.string().trim().min(1).max(300),
  mimeType: allowedMimeSchema,
  sizeBytes: z.coerce.number().int().positive(),
});
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;

export const getDownloadUrlSchema = z.object({
  attachmentId: z.uuid(),
});
export type GetDownloadUrlInput = z.infer<typeof getDownloadUrlSchema>;
