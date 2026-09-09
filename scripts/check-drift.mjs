/**
 * Fails when the Drizzle schema and the applied migrations disagree.
 *
 * supabase/migrations/*.sql is the source of truth. If `drizzle-kit generate`
 * would produce a new migration, then db/schema has drifted away from it and
 * one of the two is wrong. CI must not let that through: a stale Drizzle schema
 * means generated types that lie about the database.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";

const SCHEMA_DIR = "db/schema";
const hasSchema = existsSync(SCHEMA_DIR) && readdirSync(SCHEMA_DIR).some((f) => f.endsWith(".ts"));

if (!hasSchema) {
  console.log("db/schema is empty — no Drizzle schema to check yet (Build 02 adds it).");
  process.exit(0);
}

const before = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
execFileSync("pnpm", ["exec", "drizzle-kit", "generate"], { stdio: "inherit" });
const after = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
const added = after.filter((f) => !before.includes(f));

if (added.length > 0) {
  console.error(
    `\n✗ Schema drift. drizzle-kit generated ${added.length} migration(s) that were not committed:\n` +
      added.map((f) => `    ${f}`).join("\n") +
      "\n\nEither commit them, or fix db/schema to match supabase/migrations.\n"
  );
  process.exit(1);
}
console.log("✓ No schema drift.");
