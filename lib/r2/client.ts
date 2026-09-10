import "server-only";
import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

/**
 * R2 speaks the S3 API (01-hld.md §9) — one client, region "auto", pointed at
 * the account's R2 S3 endpoint. Never imported by a client component: R2
 * credentials are server secrets, and every operation here is either a
 * presign (the URL is short-lived and scoped to one key) or a server-side
 * HeadObject/list, never a direct read/write of file bytes through this app.
 */
let cached: S3Client | undefined;

export function r2Client(): S3Client {
  if (!cached) {
    cached = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return cached;
}
