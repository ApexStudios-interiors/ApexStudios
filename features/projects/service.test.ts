import { describe, expect, it } from "vitest";
import {
  LOCATION_MAX_LENGTH,
  PACKAGE_NAME_MAX_LENGTH,
  isSameProjectName,
  isValidLocation,
  isValidPackageName,
  normalisePackageNames,
  projectCodeBase,
} from "./service";

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

describe("isValidLocation", () => {
  it("accepts a real address", () => {
    expect(isValidLocation("Ghanpur, Hyderabad")).toBe(true);
  });

  it("rejects a phone number on its own", () => {
    expect(isValidLocation("98765456789")).toBe(false);
  });

  it("rejects digits and punctuation with no letter anywhere", () => {
    expect(isValidLocation("+91 98765-45678")).toBe(false);
    expect(isValidLocation("123456")).toBe(false);
    expect(isValidLocation("!@#$%")).toBe(false);
  });

  it("stays optional — empty and whitespace-only are fine", () => {
    expect(isValidLocation("")).toBe(true);
    expect(isValidLocation("   ")).toBe(true);
  });

  it("accepts a non-Latin script", () => {
    expect(isValidLocation("హైదరాబాద్")).toBe(true);
  });

  it("caps the length at 200 characters, measured after trimming", () => {
    expect(isValidLocation("A".repeat(LOCATION_MAX_LENGTH))).toBe(true);
    expect(isValidLocation("A".repeat(LOCATION_MAX_LENGTH + 1))).toBe(false);
    expect(isValidLocation(`  ${"A".repeat(LOCATION_MAX_LENGTH)}  `)).toBe(true);
  });
});

describe("isValidPackageName", () => {
  it("accepts the names the owner listed", () => {
    for (const name of ["Interiors", "MEP", "Facade", "MEP & HVAC", "Block-A / Tower 2"]) {
      expect(isValidPackageName(name)).toBe(true);
    }
  });

  it("accepts a dot and a digit", () => {
    expect(isValidPackageName("Phase 2.1")).toBe(true);
  });

  it("rejects punctuation soup", () => {
    expect(isValidPackageName("Facade !@#$%^&*")).toBe(false);
  });

  it("rejects an empty or whitespace-only entry", () => {
    expect(isValidPackageName("")).toBe(false);
    expect(isValidPackageName("   ")).toBe(false);
  });

  it("measures 1–60 characters after trimming", () => {
    expect(isValidPackageName(` ${"A".repeat(PACKAGE_NAME_MAX_LENGTH)} `)).toBe(true);
    expect(isValidPackageName("A".repeat(PACKAGE_NAME_MAX_LENGTH + 1))).toBe(false);
  });
});

describe("normalisePackageNames", () => {
  it("splits nothing — it trims, drops blanks and drops duplicates", () => {
    expect(normalisePackageNames(["Interiors", " MEP ", "", "   ", "Facade"])).toEqual([
      "Interiors",
      "MEP",
      "Facade",
    ]);
  });

  it("drops a case-insensitive duplicate, keeping the first spelling", () => {
    expect(normalisePackageNames(["Interiors", "interiors", "INTERIORS"])).toEqual(["Interiors"]);
  });

  it("leaves an empty submission empty", () => {
    expect(normalisePackageNames([])).toEqual([]);
    expect(normalisePackageNames(["", " "])).toEqual([]);
  });
});

describe("isSameProjectName", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(isSameProjectName("Model Villas", " model villas ")).toBe(true);
  });

  it("does not treat different names as the same", () => {
    expect(isSameProjectName("Model Villas", "Model Villas 2")).toBe(false);
  });
});
