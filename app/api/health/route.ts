import { HeadBucketCommand } from "@aws-sdk/client-s3";
import postgres from "postgres";
import { env } from "@/lib/env";
import { r2Client } from "@/lib/r2/client";
import { cachedProbe } from "@/lib/observability/cached-probe";

/**
 * GET /api/health — architecture.md §9.3.
 *
 * 200 with { db, r2, version, uptime } when a `select 1` and an R2 HeadBucket
 * both succeed, 503 otherwise. Used by uptime monitoring and by the deploy
 * pipeline's smoke check, so it must never require authentication and must
 * never leak configuration: no URLs, no bucket names, no error strings from
 * the driver. A boolean is the whole contract.
 *
 * APX-57: because it is public, it no longer opens a NEW database connection
 * (and a new S3 client) on every hit. One small connection is kept per server
 * instance, and the result of a check is reused for CHECK_TTL_MS — so a flood
 * of requests costs one real check per window per instance, not one each.
 * `uptime` is still computed per response.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const startedAt = Date.now();
const TIMEOUT_MS = 3000;
const CHECK_TTL_MS = 15_000;

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

let sql: ReturnType<typeof postgres> | undefined;
function healthConnection(): ReturnType<typeof postgres> {
  // max 1 and a short idle timeout: the connection is dropped between quiet
  // periods rather than held open for the life of the instance.
  sql ??= postgres(env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 3, prepare: false });
  return sql;
}

async function checkDb(): Promise<boolean> {
  try {
    await withTimeout(healthConnection()`select 1`, "db");
    return true;
  } catch {
    return false;
  }
}

async function checkR2(): Promise<boolean> {
  try {
    await withTimeout(r2Client().send(new HeadBucketCommand({ Bucket: env.R2_BUCKET })), "r2");
    return true;
  } catch {
    return false;
  }
}

const probe = cachedProbe(async () => {
  const [db, r2] = await Promise.all([checkDb(), checkR2()]);
  return { db, r2 };
}, CHECK_TTL_MS);

export async function GET() {
  const { db, r2 } = await probe();
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
