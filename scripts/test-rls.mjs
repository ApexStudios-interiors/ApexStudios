/**
 * Runs the pgTAP policy suite against a real Postgres.
 *
 * Exits non-zero on an empty suite. "0 tests passed" must never read as green:
 * this is the suite that protects the product's core promise, that a client
 * cannot read internal cost or margin.
 *
 * D14 removed the local Docker stack, so the target is a hosted database:
 * the linked project locally, or the pull request's Supabase preview branch in
 * CI, passed as SUPABASE_DB_URL. Never production — see the guard below.
 * docs/02-lld.md §6.3: policies are exercised from a real session, never the
 * SQL editor, which bypasses RLS and reports a broken policy as working.
 */
import { readdirSync, existsSync, readFileSync } from "node:fs";
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

const dbUrl = process.env.SUPABASE_DB_URL;
const prodRef = process.env.SUPABASE_PROD_PROJECT_REF?.trim();

let target;
if (dbUrl) {
  if (prodRef && dbUrl.includes(prodRef)) {
    console.error("✗ Refusing to run the pgTAP suite against production.");
    process.exit(1);
  }
  target = ["--db-url", dbUrl];
} else {
  const refFile = "supabase/.temp/project-ref";
  if (!existsSync(refFile)) {
    console.error(
      "✗ No target database. Set SUPABASE_DB_URL (CI uses the preview branch),\n" +
        "  or run `pnpm db:link` to link a non-production project."
    );
    process.exit(1);
  }
  const ref = readFileSync(refFile, "utf8").trim();
  if (prodRef && ref === prodRef) {
    console.error("✗ Refusing to run the pgTAP suite against production.");
    process.exit(1);
  }
  target = ["--linked"];
}

console.log(`Running ${tests.length} pgTAP file(s)...`);
const r = spawnSync("pnpm", ["exec", "supabase", "test", "db", ...target], { stdio: "inherit" });
process.exit(r.status ?? 1);
