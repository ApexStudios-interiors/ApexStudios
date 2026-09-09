/**
 * Fails loudly, naming every missing or malformed key.
 *
 * Runs the same zod schemas as lib/env.ts, but from plain Node so it can be a
 * pre-flight check in CI and a one-command answer to "why won't it boot?".
 */
import { config } from "dotenv";
import { z } from "zod";

config({ path: ".env.local", quiet: true });

const server = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  CRON_SECRET: z.string().min(32),
  SENTRY_DSN: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
});

const client = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
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
