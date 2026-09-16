import "server-only";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

/**
 * D17's own requirement (docs/decisions.md): "the alert asserts that an
 * object was actually written to apex-backups, not merely that the handler
 * did not throw." This handler's entire job IS that assertion — its failure
 * (a thrown exception, caught by runner.ts, landing the job in `failed` and
 * on the Admin ops page) is the alert. Daily at 02:30 IST, half an hour after
 * the GitHub Actions workflow (`.github/workflows/backup-nightly.yml`) is
 * expected to have finished writing the previous day's dump.
 *
 * Its own S3Client, not `lib/r2/client.ts`'s: that one is pointed at
 * `R2_BUCKET` (the app bucket) by construction, and this check reads a
 * DIFFERENT bucket (`R2_BACKUP_BUCKET`) — sharing the client would mean
 * sharing its bucket, not just its credentials.
 *
 * And its own CREDENTIALS where they exist, which is the half that was
 * missing. A Cloudflare R2 token carries one permission level across every
 * bucket it is scoped to, so the app token — necessarily read-write on
 * `R2_BUCKET` — cannot also be read-only on the backup bucket. Using it here
 * would mean anything holding `R2_SECRET_ACCESS_KEY` could delete the only
 * recovery point, which is the exact thing D17 exists to prevent. A second,
 * Object Read-only token scoped to the backup bucket closes that.
 *
 * Falls back to the app credential when the read-only pair is unset, so this
 * keeps working on an environment that has not been given one yet.
 */
export async function verifyBackup(): Promise<void> {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_BACKUP_ACCESS_KEY_ID ?? env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_BACKUP_SECRET_ACCESS_KEY ?? env.R2_SECRET_ACCESS_KEY,
    },
  });

  const todayKey = `pg_dump/${new Date().toISOString().slice(0, 10)}.sql.gz`;
  // HeadObjectCommand throws (NotFound) if the object is missing — letting
  // that exception propagate out of this handler is the entire check.
  await client.send(new HeadObjectCommand({ Bucket: env.R2_BACKUP_BUCKET, Key: todayKey }));
}
