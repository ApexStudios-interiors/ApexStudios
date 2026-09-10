/**
 * Resets the LINKED Supabase project: drops, re-migrates, re-seeds.
 *
 * D14 removed the local Docker stack, so there is no throwaway database any
 * more — this command destroys real data on a real hosted project. Two guards
 * stand in front of it:
 *
 *   1. It refuses when the linked project ref matches SUPABASE_PROD_PROJECT_REF.
 *   2. It requires the project ref to be typed back, or --yes on a CI runner.
 *
 * `supabase db reset --linked` has no undo and no confirmation of its own.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const REF_FILE = "supabase/.temp/project-ref";

if (!existsSync(REF_FILE)) {
  console.error(
    "✗ No linked Supabase project.\n" +
      "  Run `pnpm db:link` first. D14: there is no local database to fall back on."
  );
  process.exit(1);
}

const ref = readFileSync(REF_FILE, "utf8").trim();
const prodRef = process.env.SUPABASE_PROD_PROJECT_REF?.trim();

if (prodRef && ref === prodRef) {
  console.error(
    `✗ Refusing to reset ${ref}: that is the production project.\n` +
      "  Production schema changes arrive through a merged, CI-verified migration\n" +
      "  (docs/architecture.md §5.2). There is no path where resetting it is right."
  );
  process.exit(1);
}

if (!prodRef) {
  console.warn(
    "⚠ SUPABASE_PROD_PROJECT_REF is not set, so the production guard is inactive.\n" +
      "  Set it in .env.local and in CI. Continuing.\n"
  );
}

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
