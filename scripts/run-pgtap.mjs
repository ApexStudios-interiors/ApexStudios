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
import { assertNotProduction } from "./lib/db-target.mjs";

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
// The suite creates and rolls back fixture rows and runs as a privileged
// connection; it never runs against the one live project (docs/decisions.md D49).
assertNotProduction([dbUrl], "the pgTAP suite");

const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {} });

const TAP_LINE = /^(not )?ok\s+\d+/;
// A file whose FIRST line is `-- KNOWN FAILURE APX-<id>: <reason>` is not run,
// and is listed loudly in the summary. It exists for a file that is stale
// against the product (not for a failing policy): the reason and the issue id
// are mandatory, and a skipped file is never counted as passing.
const KNOWN_FAILURE = /^--\s*KNOWN FAILURE (APX-[\w-]+):\s*(.+)$/;
let totalOk = 0;
let totalNotOk = 0;
let sawAnyLine = false;
const erroredFiles = [];
const skippedFiles = [];

try {
  for (const file of files) {
    const full = path.join(DIR, file);
    console.log(`\n── ${full} ──`);
    const text = readFileSync(full, "utf8");
    const known = KNOWN_FAILURE.exec(text.split("\n", 1)[0] ?? "");
    if (known) {
      console.log(`  # SKIP — KNOWN FAILURE ${known[1]}: ${known[2]}`);
      skippedFiles.push(`${full} (${known[1]})`);
      continue;
    }

    let resultSets;
    try {
      resultSets = await sql.unsafe(text);
    } catch (e) {
      // One file's exception must not hide every file after it. Each file is
      // its own `begin … rollback`, so the connection is reusable once the
      // aborted transaction is closed.
      console.error(`  ✗ ${full} aborted: ${e.message}`);
      erroredFiles.push(full);
      await sql.unsafe("rollback").catch(() => {});
      continue;
    }

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
if (skippedFiles.length > 0) {
  console.warn(`⚠ ${skippedFiles.length} file(s) NOT RUN, marked KNOWN FAILURE:`);
  for (const f of skippedFiles) console.warn(`    ${f}`);
}
if (erroredFiles.length > 0) {
  console.error(`✗ ${erroredFiles.length} file(s) aborted with an error before finishing:`);
  for (const f of erroredFiles) console.error(`    ${f}`);
  process.exit(1);
}

if (!sawAnyLine) {
  console.error("✗ No TAP output was produced. Something is wrong with the runner or the files.");
  process.exit(1);
}
if (totalNotOk > 0) {
  console.error(`✗ ${totalNotOk} assertion(s) failed.`);
  process.exit(1);
}
console.log("✓ all pgTAP assertions passed");
