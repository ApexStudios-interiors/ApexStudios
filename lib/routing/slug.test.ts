import { describe, expect, it } from "vitest";
import { isUuid, packageSlug, projectSlug, slugify, splitPackageSegment } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Facade and Windows")).toBe("facade-and-windows");
  });

  it("handles the punctuation real package names use", () => {
    // These are the exact forms D57 deliberately allows in a package name.
    expect(slugify("MEP & HVAC")).toBe("mep-hvac");
    expect(slugify("Block-A / Tower 2")).toBe("block-a-tower-2");
    expect(slugify("Plastering and Putty")).toBe("plastering-and-putty");
  });

  it("folds accents instead of dropping the letter", () => {
    // "Façade" must not become "faade".
    expect(slugify("Façade")).toBe("facade");
  });

  it("collapses runs and trims the ends", () => {
    expect(slugify("  --MEP   &&&   HVAC--  ")).toBe("mep-hvac");
  });

  it("returns empty when nothing survives, so callers can fall back", () => {
    expect(slugify("***")).toBe("");
    expect(slugify("   ")).toBe("");
  });
});

describe("projectSlug", () => {
  it("lowercases the project code", () => {
    expect(projectSlug("BHEL-NCH")).toBe("bhel-nch");
    expect(projectSlug("SNOWFLAK-2")).toBe("snowflak-2");
  });
});

describe("packageSlug", () => {
  it("uses the name when it is unambiguous", () => {
    expect(packageSlug("Swimming Pool", 1)).toBe("swimming-pool");
  });

  it("appends the sequence number to disambiguate a duplicate name", () => {
    // This database really does have two packages named "Test".
    expect(packageSlug("Test", 8, true)).toBe("test-8");
  });

  it("falls back to the sequence number when the name slugifies to nothing", () => {
    expect(packageSlug("***", 7)).toBe("7");
    expect(packageSlug("***", 7, true)).toBe("7");
  });
});

describe("splitPackageSegment", () => {
  it("reports no number when there is none", () => {
    expect(splitPackageSegment("facade-and-windows")).toEqual({
      name: "facade-and-windows",
      seqNo: null,
    });
  });

  it("reports a trailing number", () => {
    expect(splitPackageSegment("test-8")).toEqual({ name: "test", seqNo: 8 });
  });

  it("reports a bare number as a sequence with no name", () => {
    expect(splitPackageSegment("7")).toEqual({ name: "", seqNo: 7 });
  });

  it("still reports the number for a name that genuinely ends in one", () => {
    // "tower-2" is a real name. The resolver decides whether to USE the
    // number; this function only says what is present.
    expect(splitPackageSegment("block-a-tower-2")).toEqual({ name: "block-a-tower", seqNo: 2 });
  });
});

describe("isUuid", () => {
  it("recognises the ids currently in the URL", () => {
    expect(isUuid("00000000-0000-4000-8000-0000000000c1")).toBe(true);
    expect(isUuid("694a5fbd-295f-493e-9e4f-d598706a9374")).toBe(true);
  });

  it("rejects a readable segment", () => {
    expect(isUuid("bhel-nch")).toBe(false);
    expect(isUuid("facade-and-windows")).toBe(false);
    expect(isUuid("7")).toBe(false);
  });
});
