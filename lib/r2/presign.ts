import "server-only";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";
import { r2Client } from "./client";

/** build/06-files-jobs-daily-updates.md §2.1: PUT gets a 5-minute TTL — long
 *  enough for a slow upload on a site connection, short enough that a leaked
 *  URL is useless within the hour. `ContentType` is signed (the object is
 *  stored with the right type); size is NOT — a browser's actual
 *  Content-Length header would have to match a signed value exactly or the
 *  PUT fails with an opaque signature error, which is worse than the real
 *  control: `confirmUpload`'s HeadObject re-checks the size that actually
 *  landed, against what was declared at request time. */
export async function presignPut(key: string, mime: string): Promise<string> {
  const command = new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, ContentType: mime });
  return getSignedUrl(r2Client(), command, { expiresIn: 5 * 60 });
}

/** 15-minute TTL (01-hld.md §9). `disposition` forces a download rather than
 *  an inline render for anything that isn't a photo shown in a grid — a PDF
 *  or a document should never open inside the browser tab it was linked
 *  from. */
export async function presignGet(key: string, disposition?: "attachment"): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    ...(disposition && { ResponseContentDisposition: "attachment" }),
  });
  return getSignedUrl(r2Client(), command, { expiresIn: 15 * 60 });
}
