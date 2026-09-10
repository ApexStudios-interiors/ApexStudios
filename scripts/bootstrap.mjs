/**
 * Everything Build 02 needs, in the one order that makes sense, against a fresh
 * apex-dev project.
 *
 * The ordering is the point. The D15 spike runs immediately after the migrations
 * and before the seed, because a FAIL there means migration 0014's whole
 * column-isolation design is wrong and the drafts have to be edited. Discovering
 * that after seeding and testing wastes the run; discovering it after Build 04
 * builds on it wastes a week.
 *
 * Usage: pnpm db:bootstrap
 */
import { config } from "dotenv";
import { spawnSync } from "node:child_process";

config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL;
if (!url || url.includes("placeholder")) {
  console.error("✗ DATABASE_URL is missing or still a placeholder in .env.local");
  process.exit(1);
}
const prod = process.env.SUPABASE_PROD_PROJECT_REF?.trim();
if (prod && !prod.includes("placeholder") && url.includes(prod)) {
  console.error("✗ DATABASE_URL points at production. Refusing.");
  process.exit(1);
}

const steps = [
  { name: "Inspect the database", cmd: ["pnpm", "db:inspect"], soft: true },
  { name: "Apply migrations", cmd: ["pnpm", "exec", "supabase", "db", "push", "--db-url", url] },
  {
    name: "D15 spike — definer views under force RLS",
    cmd: ["pnpm", "spike:d15"],
    note: "A FAIL here means migration 0014 must change before anything else is trusted.",
  },
  { name: "Seed", cmd: ["psql", url, "-v", "ON_ERROR_STOP=1", "-f", "supabase/seed.sql"] },
  { name: "pgTAP: structural, policy matrix, seed invariants", cmd: ["pnpm", "test:rls"] },
  { name: "Integration tests", cmd: ["pnpm", "test:integration"] },
  { name: "Release readiness", cmd: ["pnpm", "check:release"], soft: true },
];

let failed = null;
for (const [i, step] of steps.entries()) {
  console.log(`\n${"─".repeat(70)}\n[${i + 1}/${steps.length}] ${step.name}\n${"─".repeat(70)}`);
  if (step.note) console.log(`${step.note}\n`);
  const [bin, ...args] = step.cmd;
  const r = spawnSync(bin, args, { stdio: "inherit" });
  if (r.status !== 0) {
    if (step.soft) {
      console.log(`\n⏸ "${step.name}" reported something, continuing.`);
      continue;
    }
    failed = step.name;
    break;
  }
}

console.log(`\n${"═".repeat(70)}`);
if (failed) {
  console.log(`✗ Stopped at: ${failed}`);
  console.log("  Nothing after it ran. Fix that step and re-run; every step is idempotent.");
  process.exit(1);
}
console.log("✓ Build 02 verified end to end.");
console.log("  Update docs/progress-tracker.md, then open the PR.");
