/**
 * Applies supabase/seed.sql to the linked (or SUPABASE_DB_URL) database.
 *
 * Runs through `postgres` (already a project dependency) rather than shelling
 * out to `psql`. `psql` is not guaranteed to exist on a developer's machine —
 * it did not exist in the environment this was first run in — while the
 * project's own Postgres driver always does. One less external binary the
 * setup instructions have to mention.
 *
 * Idempotent: every statement in seed.sql is `on conflict do nothing` or a
 * guarded `update ... where`, so running this twice is a no-op the second time.
 * Refuses production, matching every other db:* script.
 *
 * Usage: pnpm db:seed
 */
import { config } from "dotenv";
import postgres from "postgres";
import { readFileSync } from "node:fs";

config({ path: ".env.local", quiet: true });

const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
if (!url || url.includes("placeholder")) {
  console.error("✗ DATABASE_URL is missing or still a placeholder.");
  process.exit(1);
}
const prod = process.env.SUPABASE_PROD_PROJECT_REF?.trim();
if (prod && !prod.includes("placeholder") && url.includes(prod)) {
  console.error("✗ Refusing to seed production.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  const file = readFileSync("supabase/seed.sql", "utf8");
  console.log("Applying supabase/seed.sql...");
  // A single simple-query batch, same execution model psql -f uses — every
  // statement runs in order, on one connection, respecting the file's own
  // transactional structure if it has any.
  await sql.unsafe(file);
  console.log("✓ seed applied");
} catch (e) {
  console.error("✗ seed failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
