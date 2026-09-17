import { describe, expect, it } from "vitest";
import { projectCodeBase } from "./service";

/** The shape projects_code_ck enforces (migration 0004). */
const CODE_CK = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

describe("projectCodeBase", () => {
  it("reproduces the seeded project's code from its name", () => {
    expect(projectCodeBase("BHEL Nagnar Club House")).toBe("BHEL-NCH");
  });

  it("uses the first word whole and initials for the rest", () => {
    expect(projectCodeBase("Model Villas Interiors")).toBe("MODEL-VI");
  });

  it("skips stopwords when taking initials", () => {
    expect(projectCodeBase("Villa of the Palms and Pools")).toBe("VILLA-PP");
  });

  it("treats punctuation as a word break", () => {
    expect(projectCodeBase("apex/studio: office & showroom")).toBe("APEX-SOS");
  });

  it("caps the first word at 8 and the initials at 6", () => {
    expect(projectCodeBase("Supercalifragilistic a b c d e f g h")).toBe("SUPERCAL-BCDEFG");
  });

  it("uses a single word on its own", () => {
    expect(projectCodeBase("Residence")).toBe("RESIDENC");
  });

  it("pads a too-short base to the constraint's minimum of 3", () => {
    expect(projectCodeBase("AB")).toBe("ABX");
  });

  it("falls back when the name has no letters or digits", () => {
    expect(projectCodeBase("— !")).toBe("PRJ");
  });

  it("always satisfies projects_code_ck", () => {
    for (const name of ["x", "BHEL Nagnar Club House", "a-b-c", "12 34", "Ünïcødé Villa"]) {
      const base = projectCodeBase(name);
      expect(base).toMatch(CODE_CK);
      expect(base.length).toBeGreaterThanOrEqual(3);
      expect(base.length).toBeLessThanOrEqual(20);
    }
  });
});
