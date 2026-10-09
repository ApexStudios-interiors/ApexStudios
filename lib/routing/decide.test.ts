import { describe, expect, it } from "vitest";
import { decideRoute, requestsFor } from "./decide";
import { packagePath, projectPath } from "./paths";

const BHEL = { code: "BHEL-NCH" };
const PROJECT_UUID = "00000000-0000-4000-8000-0000000000c1";
const PACKAGE_UUID = "00000000-0000-4000-8000-0000000000e2";

describe("decideRoute", () => {
  it("leaves a non-project path alone, at no cost", () => {
    expect(decideRoute("/users")).toEqual({ action: "pass", lookups: 0 });
    expect(decideRoute("/inventory")).toEqual({ action: "pass", lookups: 0 });
    expect(decideRoute("/login")).toEqual({ action: "pass", lookups: 0 });
  });

  it("rewrites a canonical project URL — one request", () => {
    expect(decideRoute("/projects/bhel-nch/billing")).toEqual({ action: "rewrite", lookups: 1 });
  });

  it("rewrites a canonical package URL", () => {
    expect(decideRoute("/projects/bhel-nch/packages/facade-and-windows/budget")).toEqual({
      action: "rewrite",
      lookups: 2,
    });
  });

  it("REDIRECTS an id URL — the cost this change exists to remove", () => {
    expect(decideRoute(`/projects/${PROJECT_UUID}/billing`).action).toBe("redirect");
    expect(decideRoute(`/projects/${PROJECT_UUID}/packages/${PACKAGE_UUID}/budget`).action).toBe("redirect");
  });
});

describe("what the navigation surfaces now emit", () => {
  // These are the exact shapes the sidebar, project cards, search and the
  // notification bell build. Each must cost ONE request, not two.
  const canonical = [
    projectPath(BHEL),
    projectPath(BHEL, "/packages"),
    projectPath(BHEL, "/schedule"),
    projectPath(BHEL, "/updates"),
    projectPath(BHEL, "/inventory"),
    projectPath(BHEL, "/stock"),
    projectPath(BHEL, "/approvals"),
    projectPath(BHEL, "/billing"),
    packagePath(BHEL, { name: "Facade and Windows", seqNo: 2 }),
    packagePath(BHEL, { name: "Test", seqNo: 8, ambiguous: true }, "/budget"),
  ];

  it.each(canonical)("%s costs one request", (path) => {
    expect(requestsFor(path)).toBe(1);
    expect(decideRoute(path).action).toBe("rewrite");
  });

  it("the id equivalents cost two — what they used to be", () => {
    const before = [
      `/projects/${PROJECT_UUID}`,
      `/projects/${PROJECT_UUID}/billing`,
      `/projects/${PROJECT_UUID}/packages/${PACKAGE_UUID}`,
    ];
    expect(before.map(requestsFor)).toEqual([2, 2, 2]);
    expect(canonical.map(requestsFor).every((n) => n === 1)).toBe(true);
  });
});
