import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Runs without a database, so it gates every build from today.
 *
 * docs/build/02-database.md §0 asks for Apex Studios' legal identity — legal
 * name, GSTIN, PAN, registered address — for the orgs seed row. It has not been
 * supplied. Those four fields print on every tax invoice this system issues, and
 * "placeholders here become placeholders on a tax invoice".
 *
 * This test fails until they are real. Delete nothing to make it pass; replace
 * the values in supabase/seed.sql.
 */
describe("seed: Apex Studios legal identity", () => {
  const seed = readFileSync("supabase/seed.sql", "utf8");

  it("has no PLACEHOLDER left in the org row", () => {
    const placeholders = seed
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => line.includes("PLACEHOLDER") && !line.trimStart().startsWith("--"));

    expect(
      placeholders.map(([n, l]) => `  seed.sql:${n}  ${l.trim()}`).join("\n"),
      "Apex Studios' legal name, GSTIN, PAN and registered address are still placeholders"
    ).toBe("");
  });
});
