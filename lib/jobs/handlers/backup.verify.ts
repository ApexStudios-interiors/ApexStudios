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
/** A gzipped pg_dump of even an empty schema is well over this; anything
 *  smaller is a truncated upload or a dump of nothing (APX-19). */
export const MIN_BACKUP_BYTES = 10 * 1024;
/** Today's dump may not be smaller than this share of yesterday's. Data is
 *  soft-deleted, never removed, so a real dump only grows; halving overnight
 *  means the dump stopped part-way or connected to the wrong database. */
export const MIN_SIZE_RATIO = 0.5;

export function backupKey(date: Date): string {
  return `pg_dump/${date.toISOString().slice(0, 10)}.sql.gz`;
}

function isNotFound(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return e.name === "NotFound" || e.name === "NoSuchKey" || status === 404;
}

export type BackupVerifySummary = { key: string; bytes: number; previousBytes: number | null };

export async function verifyBackup(): Promise<void> {
  await checkBackup(new Date());
}

/**
 * Exists, is not tiny, and has not shrunk by half since yesterday. The gzip
 * integrity of the bytes themselves is checked where they are produced —
 * `gunzip -t` in backup-nightly.yml, before the upload — because reading a
 * multi-megabyte object back through a 60-second function to decompress it
 * would cost more than the check is worth here. Every failure throws, which
 * lands the job in `failed`: that row is the alert, and the admin shell shows
 * a banner while the latest one is failed.
 */
export async function checkBackup(now: Date): Promise<BackupVerifySummary> {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_BACKUP_ACCESS_KEY_ID ?? env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_BACKUP_SECRET_ACCESS_KEY ?? env.R2_SECRET_ACCESS_KEY,
    },
  });

  const key = backupKey(now);
  // HeadObjectCommand throws (NotFound) if the object is missing — letting
  // that exception propagate out of this handler is the first check.
  const head = await client.send(new HeadObjectCommand({ Bucket: env.R2_BACKUP_BUCKET, Key: key }));
  const bytes = head.ContentLength ?? 0;
  if (bytes <= MIN_BACKUP_BYTES) {
    throw new Error(
      `BACKUP_TOO_SMALL: ${key} is ${bytes} bytes (minimum ${MIN_BACKUP_BYTES}) — see docs/runbooks/backup-failed.md`
    );
  }

  const previousKey = backupKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  let previousBytes: number | null = null;
  try {
    const prev = await client.send(new HeadObjectCommand({ Bucket: env.R2_BACKUP_BUCKET, Key: previousKey }));
    previousBytes = prev.ContentLength ?? null;
  } catch (e) {
    // No dump yesterday (the first night, or yesterday's own failure — which
    // already alerted) is not a reason to fail today's good one.
    if (!isNotFound(e)) throw e;
  }

  if (previousBytes !== null && bytes < previousBytes * MIN_SIZE_RATIO) {
    throw new Error(
      `BACKUP_SHRANK: ${key} is ${bytes} bytes, under ${MIN_SIZE_RATIO * 100}% of ${previousKey} ` +
        `(${previousBytes} bytes) — see docs/runbooks/backup-failed.md`
    );
  }

  console.log(`backup.verify: ${key} ${bytes} bytes (previous ${previousBytes ?? "none"})`);
  return { key, bytes, previousBytes };
}
