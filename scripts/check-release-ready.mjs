/**
 * Things that must be real before this system issues a document to a client.
 *
 * Separate from `pnpm test` on purpose. These are missing *inputs*, not broken
 * code, and a permanently red test suite is a suite people stop reading. This
 * runs in CI as its own reporting job, and it is a hard gate on the production
 * deploy (Build 10).
 *
 * Exit 0 = nothing on hold. Exit 1 = something here would reach a real client.
 */
import { readFileSync } from "node:fs";

const checks = [
  {
    name: "Apex Studios legal identity",
    why: "legal_name, gstin, pan and address print on every tax invoice this system issues",
    holder: "Voola — ON HOLD as of 2026-09-10",
    blocks: "the first real bill (Build 09), and any production deploy",
    find() {
      return readFileSync("supabase/seed.sql", "utf8")
        .split("\n")
        .map((line, i) => [i + 1, line])
        .filter(([, l]) => l.includes("PLACEHOLDER") && !l.trimStart().startsWith("--"))
        .map(([n, l]) => `supabase/seed.sql:${n}  ${l.trim()}`);
    },
  },
];

let held = 0;
for (const check of checks) {
  const hits = check.find();
  if (hits.length === 0) {
    console.log(`✓ ${check.name}`);
    continue;
  }
  held++;
  console.log(`\n⏸ ON HOLD — ${check.name}`);
  console.log(`  why it matters: ${check.why}`);
  console.log(`  waiting on:     ${check.holder}`);
  console.log(`  blocks:         ${check.blocks}`);
  for (const h of hits) console.log(`    ${h}`);
}

if (held > 0) {
  console.log(`\n${held} item(s) on hold. Safe to keep building; NOT safe to issue a document.`);
  process.exit(1);
}
console.log("\nNothing on hold.");
