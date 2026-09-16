/**
 * Fails loudly, naming every missing or malformed key.
 *
 * Runs the same zod schemas as lib/env.ts, but from plain Node so it can be a
 * pre-flight check in CI and a one-command answer to "why won't it boot?".
 */
import { config } from "dotenv";
import { z } from "zod";

config({ path: ".env.local", quiet: true });

// Keep in step with lib/env.ts. This is a hand-kept copy — it cannot import
// the real schema, because lib/env.ts starts with `import "server-only"` and
// parses eagerly, which is precisely what this script exists to check without
// booting. It had drifted: R2_BACKUP_BUCKET, SESSION_SECRET and
// NEXT_PUBLIC_SITE_URL were all missing, so `pnpm env:check` could report
// "server environment OK" on a config that could not actually start.
const server = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_BACKUP_BUCKET: z.string().min(1),
  // Optional: the Object Read-only token for backup.verify. Unset is valid —
  // it falls back to the app credential (see .env.example). Blank counts as
  // unset, same preprocess as lib/env.ts, so a placeholder line does not fail.
  R2_BACKUP_ACCESS_KEY_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),
  R2_BACKUP_SECRET_ACCESS_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),
  CRON_SECRET: z.string().min(32),
  SESSION_SECRET: z.string().min(32),
  SENTRY_DSN: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
});

const client = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.url(),
});

let failed = false;
for (const [name, schema] of [
  ["server", server],
  ["public", client],
]) {
  const result = schema.safeParse(process.env);
  if (result.success) {
    console.log(`✓ ${name} environment OK`);
  } else {
    failed = true;
    console.error(`✗ ${name} environment invalid:`);
    for (const issue of result.error.issues) {
      console.error(`    ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  }
}
if (failed) {
  console.error("\nSee .env.example for every key and what it is for.");
  process.exit(1);
}
