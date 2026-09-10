import { z } from "zod";
import { MAX_PHOTOS_PER_ENTITY } from "@/lib/r2/constraints";

/**
 * `id` is client-generated (`crypto.randomUUID()`, `PostUpdateDialog`), not
 * server-assigned: `FileUploader`'s photos upload and confirm BEFORE the
 * daily update row exists (`confirmUpload` needs a real `entity_id` to write
 * `attachments.entity_id` against), so the id has to be chosen first and
 * carried through both the uploads and this insert.
 */
export const postDailyUpdateSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  packageId: z.uuid(),
  updateDate: z.iso.date(),
  body: z.string().trim().min(1, "Please describe what happened today"),
  attachmentIds: z.array(z.uuid()).max(MAX_PHOTOS_PER_ENTITY).default([]),
});
export type PostDailyUpdateInput = z.infer<typeof postDailyUpdateSchema>;

export const editDailyUpdateSchema = z.object({
  id: z.uuid(),
  body: z.string().trim().min(1),
});
export type EditDailyUpdateInput = z.infer<typeof editDailyUpdateSchema>;
