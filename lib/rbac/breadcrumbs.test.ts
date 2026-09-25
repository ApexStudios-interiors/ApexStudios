import { describe, expect, it } from "vitest";
import { projectCrumbs } from "./breadcrumbs";

const base = { projectId: "p1", projectName: "BHEL Nagnar Club House" };

describe("projectCrumbs", () => {
  it("links the project and the section on a package page", () => {
    const crumbs = projectCrumbs({
      ...base,
      pathname: "/projects/p1/packages/m4",
      section: "packages",
      sectionLabel: "Packages",
      packageId: "m4",
      packageLabel: "04 External Development and Lift",
    });
    expect(crumbs.map((c) => [c.label, c.isLink ? c.href : null])).toEqual([
      ["BHEL Nagnar Club House", "/projects/p1"],
      ["Packages", "/projects/p1/packages"],
      ["04 External Development and Lift", null],
    ]);
  });

  it("leaves a section that is the current page as plain text", () => {
    const crumbs = projectCrumbs({
      ...base,
      pathname: "/projects/p1/packages",
      section: "packages",
      sectionLabel: "Packages",
    });
    expect(crumbs.map((c) => c.isLink)).toEqual([true, false]);
  });

  it("applies the same rule to every section, not just packages", () => {
    for (const [section, label] of [
      ["approvals", "Approvals"],
      ["billing", "Bills"],
      ["schedule", "Schedule"],
      ["updates", "Daily Updates"],
      ["inventory", "Inventory"],
      ["stock", "Stock Requests"],
    ] as const) {
      const here = projectCrumbs({
        ...base,
        pathname: `/projects/p1/${section}`,
        section,
        sectionLabel: label,
      });
      expect(here.map((c) => c.isLink)).toEqual([true, false]);

      const deeper = projectCrumbs({
        ...base,
        pathname: "/projects/p1/packages/m1",
        section,
        sectionLabel: label,
        packageId: "m1",
        packageLabel: "01 Civil",
      });
      expect(deeper[1]).toEqual({
        label,
        href: `/projects/p1/${section}`,
        isLink: true,
      });
    }
  });

  it("never links the project to itself on the dashboard", () => {
    const crumbs = projectCrumbs({
      ...base,
      pathname: "/projects/p1",
      section: "dashboard",
      sectionLabel: "Dashboard",
    });
    expect(crumbs.map((c) => c.isLink)).toEqual([false, false]);
  });

  it("does not link an unknown project name", () => {
    const crumbs = projectCrumbs({
      ...base,
      projectName: "",
      pathname: "/projects/p1/schedule",
      section: "schedule",
      sectionLabel: "Schedule",
    });
    expect(crumbs[0]).toEqual({ label: "", href: null, isLink: false });
  });

  it("does not link a package crumb to the page it is already on", () => {
    const crumbs = projectCrumbs({
      ...base,
      pathname: "/projects/p1/packages/m4",
      section: "packages",
      sectionLabel: "Packages",
      packageId: "m4",
      packageLabel: "04 External Development and Lift",
    });
    expect(crumbs[2]?.isLink).toBe(false);
  });
});
