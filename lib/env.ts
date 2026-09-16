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
  // build/06 D17: backup.verify's own HeadObject check that a real nightly
  // backup object exists — read-only (Head/List), never write/delete, on the
  // separately-scoped apex-backups bucket. build §0.1's "the app token
  // genuinely cannot write to the backup bucket" is a write/delete
  // restriction; a read-only credential for THIS one check is the documented
  // exception, not a bypass of it (docs/decisions.md D17).
  R2_BACKUP_BUCKET: z.string().min(1),

  // The read-only half of D17, and the reason it needs its own credential: a
  // Cloudflare R2 token carries ONE permission level across every bucket it is
  // scoped to. The app token must be read-WRITE on R2_BUCKET (presigned
  // uploads, bill PDFs, thumbnails, the orphan sweep's deletes), so scoping it
  // to the backup bucket as well would hand write and delete over the backups
  // to anything holding R2_SECRET_ACCESS_KEY — precisely what D17 forbids.
  // "Grant the app credential read-only access to apex-backups" is therefore
  // unsatisfiable with a single token; it takes a second, Object Read-only one.
  //
  // Optional on purpose. Unset, backup.verify falls back to the app credential
  // and behaves exactly as before — a missing var must never be the thing that
  // fails a Vercel build. Set, the app can read the backups and provably
  // cannot write them.
  R2_BACKUP_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_BACKUP_SECRET_ACCESS_KEY: z.string().min(1).optional(),

  // Guards every /api/cron/* route. 32 bytes base64 is 44 characters.
  CRON_SECRET: z.string().min(32),

  // Signs the impersonation cookie (build/03-auth-and-rbac.md §2.9, D20).
  // HMAC key only — never sent anywhere, never used for anything but proving
  // this application issued the cookie it is currently reading back.
  SESSION_SECRET: z.string().min(32),

  // A blank line in .env is an empty string, not undefined. Treat it as absent
  // so `SENTRY_DSN=` reads as "Sentry off" rather than "malformed URL".
  SENTRY_DSN: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),

  // build/09-billing.md §4.8 / architecture.md §10.2: Billing ships dark
  // until a CA has reviewed a generated RA bill PDF and signed off in
  // writing (docs/decisions.md). `z.coerce.boolean()` is deliberately NOT
  // used here — it treats the literal string "false" as truthy, which is
  // exactly the footgun a feature flag can least afford.
  BILLING_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
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
