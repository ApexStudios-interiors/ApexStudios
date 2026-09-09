import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once at module load.
 *
 * The build must fail loudly on a missing variable, naming it — not at 2 a.m.
 * on a null dereference. `docs/build/01-foundations.md` §3.8.
 *
 * SKIP_ENV_VALIDATION exists for one case only: `next build` in CI, which has
 * no secrets and does not need them to compile. It must never be set at runtime.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),

  // Supabase — DATABASE_URL is for migrations and Drizzle only (D11).
  DATABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Cloudflare R2 — private bucket, presigned URLs only.
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),

  // Guards every /api/cron/* route. 32 bytes base64 is 44 characters.
  CRON_SECRET: z.string().min(32),

  // A blank line in .env is an empty string, not undefined. Treat it as absent
  // so `SENTRY_DSN=` reads as "Sentry off" rather than "malformed URL".
  SENTRY_DSN: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function parseEnv(): ServerEnv {
  if (process.env.SKIP_ENV_VALIDATION === "1") {
    // Build-time only. Anything reading these at runtime will still fail fast.
    return process.env as unknown as ServerEnv;
  }
  const result = serverSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment. Fix .env.local (see .env.example):\n${problems}`);
  }
  return result.data;
}

export const env: ServerEnv = parseEnv();
