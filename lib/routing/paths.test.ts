import { describe, expect, it } from "vitest";
import { isUuid } from "./slug";
import { packagePath, projectPath, withAmbiguityFlags } from "./paths";

const BHEL = { code: "BHEL-NCH" };

describe("projectPath", () => {
  it("builds the canonical project URL", () => {
    expect(projectPath(BHEL)).toBe("/projects/bhel-nch");
  });

  it("appends a sub-path", () => {
    expect(projectPath(BHEL, "/billing")).toBe("/projects/bhel-nch/billing");
  });

  it("never emits a UUID — the whole point, since a UUID href costs a redirect", () => {
    const path = projectPath(BHEL, "/stock");
    expect(path.split("/").some(isUuid)).toBe(false);
  });
});

describe("packagePath", () => {
  it("builds the canonical package URL", () => {
    expect(packagePath(BHEL, { name: "Facade and Windows", seqNo: 2 })).toBe(
      "/projects/bhel-nch/packages/facade-and-windows"
    );
  });

  it("appends a tab", () => {
    expect(packagePath(BHEL, { name: "MEP", seqNo: 5 }, "/budget")).toBe(
      "/projects/bhel-nch/packages/mep/budget"
    );
  });

  it("appends the sequence number when the name is ambiguous", () => {
    expect(packagePath(BHEL, { name: "Test", seqNo: 8, ambiguous: true })).toBe(
      "/projects/bhel-nch/packages/test-8"
    );
  });

  it("falls back to the sequence number when the name slugifies to nothing", () => {
    expect(packagePath(BHEL, { name: "***", seqNo: 7 })).toBe("/projects/bhel-nch/packages/7");
  });
});

describe("withAmbiguityFlags", () => {
  it("flags only the names that actually collide", () => {
    const flagged = withAmbiguityFlags([
      { name: "Swimming Pool", seqNo: 1 },
      { name: "Test", seqNo: 8 },
      { name: "Test", seqNo: 9 },
    ]);
    expect(flagged.map((p) => p.ambiguous)).toEqual([false, true, true]);
  });

  it("gives two same-named packages DIFFERENT hrefs", () => {
    const [a, b] = withAmbiguityFlags([
      { name: "Test", seqNo: 8 },
      { name: "Test", seqNo: 9 },
    ]);
    expect(a && b && packagePath(BHEL, a) !== packagePath(BHEL, b)).toBe(true);
  });

  it("leaves a unique name unflagged, so its URL stays readable", () => {
    const [only] = withAmbiguityFlags([{ name: "Interiors", seqNo: 3 }]);
    expect(only && packagePath(BHEL, only)).toBe("/projects/bhel-nch/packages/interiors");
  });
});
