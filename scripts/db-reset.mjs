/**
 * Resets the LINKED Supabase project: drops, re-migrates, re-seeds.
 *
 * D14 removed the local Docker stack, so there is no throwaway database any
 * more — this command destroys real data on a real hosted project, and since
 * D49 there is exactly one such project and it is production. Two guards stand
 * in front of it:
 *
 *   1. It refuses when the linked project ref matches SUPABASE_PROD_PROJECT_REF,
 *      and — new with D49 — when that variable is absent on a non-interactive
 *      run, because then nothing can prove the target is not production.
 *      `scripts/lib/db-target.mjs` holds that check for every entry point.
 *   2. It requires the project ref to be typed back, or --yes on a CI runner.
 *
 * `supabase db reset --linked` has no undo and no confirmation of its own.
 */
import { config } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { assertNotProduction } from "./lib/db-target.mjs";

// The production ref lives in .env.local alongside every other Supabase value;
// reading it only from the shell environment left the guard off by default.
config({ path: ".env.local", quiet: true, override: false });

const REF_FILE = "supabase/.temp/project-ref";

if (!existsSync(REF_FILE)) {
  console.error(
    "✗ No linked Supabase project.\n" +
      "  Run `pnpm db:link` first. D14: there is no local database to fall back on."
  );
  process.exit(1);
}

const ref = readFileSync(REF_FILE, "utf8").trim();

// Shared with db:seed, the pgTAP runner and the integration suite — one guard,
// one definition of "this is production" (docs/decisions.md D49).
assertNotProduction([ref], "a database reset");

const args = process.argv.slice(2);
if (!args.includes("--yes")) {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`About to DROP and re-seed the linked project: ${ref}`);
  const typed = await rl.question(`Type the project ref to confirm: `);
  rl.close();
  if (typed.trim() !== ref) {
    console.error("✗ Did not match. Nothing was changed.");
    process.exit(1);
  }
}

const r = spawnSync("pnpm", ["exec", "supabase", "db", "reset", "--linked"], { stdio: "inherit" });
process.exit(r.status ?? 1);
