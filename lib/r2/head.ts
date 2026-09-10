import "server-only";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { r2Client } from "./client";

export type HeadResult = { exists: true; sizeBytes: number; etag: string } | { exists: false };

/**
 * `confirmUpload`'s whole reason to exist (build §2.2): "we record only what
 * we can verify". A 404/NoSuchKey from R2 means the PUT never happened or
 * was abandoned — that is a normal, expected outcome here, not an error to
 * propagate, so it comes back as `{ exists: false }` rather than a thrown
 * exception the caller has to know to catch by error code.
 */
export async function headObject(key: string): Promise<HeadResult> {
  try {
    const result = await r2Client().send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    if (result.ContentLength == null || !result.ETag) {
      return { exists: false };
    }
    return { exists: true, sizeBytes: result.ContentLength, etag: result.ETag };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "NotFound" || name === "NoSuchKey") return { exists: false };
    throw e;
  }
}
