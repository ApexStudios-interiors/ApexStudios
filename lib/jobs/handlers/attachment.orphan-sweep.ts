import "server-only";
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { r2Client } from "@/lib/r2/client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Weekly (build §3.5): delete R2 objects with no matching `attachments` row,
 * older than 24 hours. The 24-hour floor is essential — a shorter window
 * races `confirmUpload` and deletes a file that is mid-upload, not actually
 * orphaned. Every deletion is logged (Vercel's own log capture); a dry-run
 * flag exists for the first month in production per the build file's own
 * recommendation, read before enabling real deletion.
 */
export async function sweepOrphanAttachments(payload?: unknown): Promise<void> {
  const dryRun = (payload as { dryRun?: boolean } | undefined)?.dryRun ?? false;
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const supabase = createAdminClient();

  // One query for every referenced key, not one query per candidate object —
  // the bucket can hold far more objects than a per-object round trip to
  // Postgres should cost.
  const referenced = new Set<string>();
  const { data: rows, error } = await supabase.from("attachments").select("r2_key, thumb_r2_key");
  if (error) throw new Error(error.message);
  for (const row of rows ?? []) {
    referenced.add(row.r2_key);
    if (row.thumb_r2_key) referenced.add(row.thumb_r2_key);
  }

  let continuationToken: string | undefined;
  let deleted = 0;
  let scanned = 0;

  do {
    const page = await r2Client().send(
      new ListObjectsV2Command({ Bucket: env.R2_BUCKET, ContinuationToken: continuationToken })
    );

    for (const obj of page.Contents ?? []) {
      scanned++;
      if (!obj.Key || !obj.LastModified) continue;
      if (obj.LastModified.getTime() >= cutoffMs) continue; // too young — could be mid-upload
      if (referenced.has(obj.Key)) continue; // a real, referenced object

      if (!dryRun) {
        await r2Client().send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: obj.Key }));
      }
      deleted++;
      console.log(`attachment.orphan_sweep: ${dryRun ? "[dry run] would delete" : "deleted"} ${obj.Key}`);
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  console.log(`attachment.orphan_sweep: scanned ${scanned} object(s), ${deleted} orphaned`);
}
