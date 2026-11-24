import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UNIT_CODES, createStockRequestSchema, isUnitCode } from "../schema";

/**
 * APX-40: the New Stock Request unit is an enum mirroring `public.units`.
 * This keeps the two from drifting: every unit code any migration inserts
 * into `public.units` must be in UNIT_CODES, and nothing else may be.
 */
function unitCodesFromMigrations(): string[] {
  const dir = join(process.cwd(), "supabase", "migrations");
  const codes = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, file), "utf8");
    const re = /insert into public\.units\s*\([^)]*\)\s*values([\s\S]*?);/gi;
    for (const m of sql.matchAll(re)) {
      for (const row of (m[1] ?? "").matchAll(/\(\s*'([^']+)'/g)) {
        if (row[1]) codes.add(row[1]);
      }
    }
  }
  return [...codes].sort();
}

describe("UNIT_CODES", () => {
  it("matches the units the migrations seed", () => {
    expect([...UNIT_CODES].sort()).toEqual(unitCodesFromMigrations());
  });

  it("isUnitCode narrows a database unit to the enum", () => {
    expect(isUnitCode("sft")).toBe(true);
    expect(isUnitCode("kg")).toBe(false);
  });
});

describe("createStockRequestSchema field messages (APX-40)", () => {
  const base = {
    projectId: "00000000-0000-4000-8000-000000000001",
    packageId: "00000000-0000-4000-8000-000000000002",
    materialName: "Cement",
    qty: "10",
    unit: "bag",
  };

  it("refuses an unknown unit with 'Choose a unit'", () => {
    const r = createStockRequestSchema.safeParse({ ...base, unit: "kg" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Choose a unit");
  });

  it("strips grouping commas from the rate", () => {
    const r = createStockRequestSchema.safeParse({ ...base, rate: "1,250.50" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rate).toBe(1250.5);
  });

  it("caps the material name", () => {
    const r = createStockRequestSchema.safeParse({ ...base, materialName: "x".repeat(121) });
    expect(r.success).toBe(false);
  });
});
