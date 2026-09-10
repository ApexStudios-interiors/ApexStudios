/**
 * Runs the pgTAP suite directly through the `postgres` driver, without Docker.
 *
 * `supabase test db` — the CLI's own runner — shells out to Docker to launch
 * pg_prove, unconditionally, even against a remote `--db-url`. `--network-id`
 * in its own --help is the tell. D14 says no Docker anywhere, so that command
 * is unusable here regardless of target, and this replaces it rather than
 * routing around it once.
 *
 * pgTAP's assertion functions (`is`, `ok`, `is_empty`, `cmp_ok`, `set_eq`, …)
 * each return one column whose value is a standard TAP line — "ok 3 - …" or
 * "not ok 3 - …" — no matter which function produced it. Executing a test file
 * as one multi-statement batch and reading those lines back is the entire
 * runner; nothing pgTAP-specific needs reimplementing.
 */
import { config } from "dotenv";
import postgres from "postgres";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

config({ path: ".env.local", quiet: true, override: false });

const DIR = "supabase/tests";
const files = existsSync(DIR)
  ? readdirSync(DIR, { recursive: true })
      .filter((f) => String(f).endsWith(".sql"))
      .sort()
  : [];

if (files.length === 0) {
  console.error(
    "✗ No pgTAP tests found in supabase/tests/.\n" + "  An empty RLS suite must never report success."
  );
  process.exit(1);
}

const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
if (!dbUrl || dbUrl.includes("placeholder")) {
  console.error("✗ No target database. Set SUPABASE_DB_URL or DATABASE_URL.");
  process.exit(1);
}
const prodRef = process.env.SUPABASE_PROD_PROJECT_REF?.trim();
if (prodRef && !prodRef.includes("placeholder") && dbUrl.includes(prodRef)) {
  console.error("✗ Refusing to run the pgTAP suite against production.");
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {} });

const TAP_LINE = /^(not )?ok\s+\d+/;
let totalOk = 0;
let totalNotOk = 0;
let sawAnyLine = false;

try {
  for (const file of files) {
    const full = path.join(DIR, file);
    console.log(`\n── ${full} ──`);
    const resultSets = await sql.unsafe(readFileSync(full, "utf8"));

    for (const rows of resultSets) {
      for (const row of rows) {
        const line = String(Object.values(row)[0] ?? "");
        if (TAP_LINE.test(line)) {
          sawAnyLine = true;
          console.log(`  ${line}`);
          if (line.startsWith("not ok")) totalNotOk++;
          else totalOk++;
        } else if (line.startsWith("#") || /^\d+\.\.\d+$/.test(line)) {
          console.log(`  ${line}`);
        }
      }
    }
  }
} catch (e) {
  console.error("\n✗ pgTAP run failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`\n${"═".repeat(60)}`);
console.log(`${totalOk} ok, ${totalNotOk} not ok, across ${files.length} file(s)`);

if (!sawAnyLine) {
  console.error("✗ No TAP output was produced. Something is wrong with the runner or the files.");
  process.exit(1);
}
if (totalNotOk > 0) {
  console.error(`✗ ${totalNotOk} assertion(s) failed.`);
  process.exit(1);
}
console.log("✓ all pgTAP assertions passed");
