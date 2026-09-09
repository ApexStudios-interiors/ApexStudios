import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import postgres from "postgres";
import { env } from "@/lib/env";

/**
 * GET /api/health — architecture.md §9.3.
 *
 * 200 with { db, r2, version, uptime } when a `select 1` and an R2 HeadBucket
 * both succeed, 503 otherwise. Used by uptime monitoring and by the deploy
 * pipeline's smoke check, so it must never require authentication and must
 * never leak configuration: no URLs, no bucket names, no error strings from
 * the driver. A boolean is the whole contract.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const startedAt = Date.now();
const TIMEOUT_MS = 3000;

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDb(): Promise<boolean> {
  const sql = postgres(env.DATABASE_URL, { max: 1, idle_timeout: 1, connect_timeout: 3 });
  try {
    await withTimeout(sql`select 1`, "db");
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}

async function checkR2(): Promise<boolean> {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  try {
    await withTimeout(client.send(new HeadBucketCommand({ Bucket: env.R2_BUCKET })), "r2");
    return true;
  } catch {
    return false;
  } finally {
    client.destroy();
  }
}

export async function GET() {
  const [db, r2] = await Promise.all([checkDb(), checkR2()]);
  const body = {
    db,
    r2,
    version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    uptime: Math.round((Date.now() - startedAt) / 1000),
  };
  return Response.json(body, {
    status: db && r2 ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
