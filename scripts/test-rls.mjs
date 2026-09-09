/**
 * Runs the pgTAP policy suite.
 *
 * Exits non-zero on an empty suite. "0 tests passed" must never read as green:
 * the RLS suite is the only thing standing between a client session and
 * internal_amount, and an empty directory is not a passing test run.
 * docs/build/01-foundations.md §3.12.
 */
import { readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DIR = "supabase/tests";
const tests = existsSync(DIR)
  ? readdirSync(DIR, { recursive: true }).filter((f) => String(f).endsWith(".sql"))
  : [];

if (tests.length === 0) {
  console.error(
    "✗ No pgTAP tests found in supabase/tests/.\n" +
      "  Build 02 writes the first ones. Until then this is a red build, deliberately:\n" +
      "  an empty RLS suite must never report success."
  );
  process.exit(1);
}

console.log(`Running ${tests.length} pgTAP file(s)...`);
const r = spawnSync("pnpm", ["exec", "supabase", "test", "db"], { stdio: "inherit" });
process.exit(r.status ?? 1);
