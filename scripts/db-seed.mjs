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
 * Refuses production through the shared guard in `scripts/lib/db-target.mjs`,
 * the same one every other db:* script and the test runners use.
 *
 * Usage: pnpm db:seed
 */
import { config } from "dotenv";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { assertNotProduction } from "./lib/db-target.mjs";

config({ path: ".env.local", quiet: true });

const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
if (!url || url.includes("placeholder")) {
  console.error("✗ DATABASE_URL is missing or still a placeholder.");
  process.exit(1);
}
// The seed writes the whole demo dataset. There is one Supabase project and it
// is production (docs/decisions.md D49), so this guard is what stands between a
// mistyped URL and demo rows in the live database.
assertNotProduction([url], "the seed");

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
