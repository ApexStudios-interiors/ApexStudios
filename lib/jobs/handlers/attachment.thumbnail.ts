import "server-only";
import sharp from "sharp";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { r2Client } from "@/lib/r2/client";
import { headObject } from "@/lib/r2/head";
import { IMAGE_MIME } from "@/lib/r2/constraints";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * build §3.5: resize to 400px on the long edge, strip EXIF, write under
 * `thumb/`, update `attachments.thumb_r2_key`. Idempotent (AGENTS.md
 * background job rule 1 — assume every job runs at least twice): if
 * `thumb_r2_key` is already set AND the object is really there, this returns
 * without re-rendering.
 *
 * EXIF stripping is `sharp`'s own default, not extra code here: it drops all
 * metadata (GPS coordinates included — location data about a client's
 * property that must not survive into storage) unless `.withMetadata()` is
 * called, which nothing here does.
 */
export async function thumbnailAttachment(payload: unknown): Promise<void> {
  const attachmentId = (payload as { attachmentId?: string }).attachmentId;
  if (!attachmentId) throw new Error("attachment.thumbnail payload is missing attachmentId");

  const supabase = createAdminClient();
  const { data: attachment, error } = await supabase
    .from("attachments")
    .select("id, r2_key, mime_type, thumb_r2_key")
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!attachment) throw new Error(`NOT_FOUND: attachment ${attachmentId} does not exist`);

  if (!(IMAGE_MIME as readonly string[]).includes(attachment.mime_type)) {
    return; // not an image — nothing to thumbnail (a PDF has no thumbnail)
  }

  const thumbKey = `thumb/${attachment.r2_key}`;

  if (attachment.thumb_r2_key === thumbKey) {
    const head = await headObject(thumbKey);
    if (head.exists) return; // already rendered, and the object is really there
  }

  const sourcePath = attachment.r2_key;
  const object = await r2Client().send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: sourcePath }));
  const bytes = await object.Body?.transformToByteArray();
  if (!bytes) throw new Error(`could not read object body for ${sourcePath}`);

  const thumbnail = await sharp(Buffer.from(bytes))
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  await r2Client().send(
    new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: thumbKey, Body: thumbnail, ContentType: "image/jpeg" })
  );

  const { error: updateError } = await supabase
    .from("attachments")
    .update({ thumb_r2_key: thumbKey })
    .eq("id", attachmentId);
  if (updateError) throw new Error(updateError.message);
}
