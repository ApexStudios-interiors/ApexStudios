import { describe, expect, it } from "vitest";
import {
  NO_ATTENTION,
  attentionScore,
  daysAgoLabel,
  daysBetween,
  filterProjects,
  normaliseProjectSearch,
  parseProjectStatusFilter,
  sortByAttention,
  type ProjectAttention,
} from "./portfolio";

const calm: ProjectAttention = { ...NO_ATTENTION, lastUpdateDays: 0 };

describe("attentionScore", () => {
  it("is zero for a live project with nothing waiting and a fresh update", () => {
    expect(attentionScore("Active", calm)).toBe(0);
  });

  it("ranks late tasks above pending approvals above low stock", () => {
    const late = attentionScore("Active", { ...calm, lateTasks: 1 });
    const approval = attentionScore("Active", { ...calm, pendingApprovals: 1 });
    const stock = attentionScore("Active", { ...calm, lowStock: 1 });
    expect(late).toBeGreaterThan(approval);
    expect(approval).toBeGreaterThan(stock);
  });

  it("nudges an aged approval and an outstanding balance", () => {
    const fresh = attentionScore("Active", { ...calm, pendingApprovals: 1, oldestApprovalDays: 2 });
    const aged = attentionScore("Active", { ...calm, pendingApprovals: 1, oldestApprovalDays: 9 });
    expect(aged).toBeGreaterThan(fresh);
    expect(attentionScore("Active", { ...calm, outstanding: 1000 })).toBeGreaterThan(0);
    expect(attentionScore("Active", { ...calm, outstanding: 0 })).toBe(0);
  });

  it("nudges an active site with no recent update, but not a planning one", () => {
    expect(attentionScore("Active", { ...calm, lastUpdateDays: null })).toBe(1);
    expect(attentionScore("Active", { ...calm, lastUpdateDays: 5 })).toBe(1);
    expect(attentionScore("Planning", { ...calm, lastUpdateDays: null })).toBe(0);
  });

  it("puts completed and archived projects below every live one, whatever their counts", () => {
    expect(attentionScore("Completed", { ...calm, lateTasks: 9 })).toBe(-1);
    expect(attentionScore("Archived", { ...calm, pendingApprovals: 9 })).toBe(-1);
  });
});

describe("sortByAttention", () => {
  const p = (id: string, status = "Active") => ({ id, status });

  it("sorts by score, highest first", () => {
    const out = sortByAttention([p("a"), p("b"), p("c")], {
      a: calm,
      b: { ...calm, lateTasks: 2 },
      c: { ...calm, pendingApprovals: 1 },
    });
    expect(out.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("is stable: equal scores keep their incoming order", () => {
    const out = sortByAttention([p("a"), p("b"), p("c")], { a: calm, b: calm, c: calm });
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("treats a project with no attention entry as calm, and sinks dormant ones", () => {
    const out = sortByAttention([p("done", "Completed"), p("x"), p("y")], { y: { ...calm, lowStock: 2 } });
    expect(out.map((x) => x.id)).toEqual(["y", "x", "done"]);
  });
});

describe("daysBetween / daysAgoLabel", () => {
  it("counts whole calendar days, across a month end", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
  });

  it("is never negative", () => {
    expect(daysBetween("2026-11-05", "2026-11-01")).toBe(0);
  });

  it("labels today, yesterday and older", () => {
    expect(daysAgoLabel(0)).toBe("today");
    expect(daysAgoLabel(1)).toBe("yesterday");
    expect(daysAgoLabel(6)).toBe("6 days ago");
  });
});

describe("filterProjects", () => {
  const projects = [
    {
      name: "BHEL Nagnar Club House",
      client: "T V Rao Housing",
      code: "BHEL-NCH",
      location: "Hyderabad",
      status: "Active",
    },
    { name: "Old Villa", client: "Mehta", code: "OLD-V", location: null, status: "Archived" },
    { name: "Model Villas", client: "Rao Estates", code: "MODEL-V", location: "Pune", status: "Completed" },
    { name: "Clinic Fitout", client: "Apollo", code: "CLINIC-F", location: "Chennai", status: "On Hold" },
  ];
  const names = (status: Parameters<typeof filterProjects>[1]["status"], q = "") =>
    filterProjects(projects, { status, q }).map((p) => p.code);

  it("hides archived projects by default", () => {
    expect(names("")).toEqual(["BHEL-NCH", "MODEL-V", "CLINIC-F"]);
  });

  it("shows archived ones under Archived and All", () => {
    expect(names("archived")).toEqual(["OLD-V"]);
    expect(names("all")).toHaveLength(4);
  });

  it("filters by one status", () => {
    expect(names("on_hold")).toEqual(["CLINIC-F"]);
    expect(names("completed")).toEqual(["MODEL-V"]);
  });

  it("searches name, client, code and location case-insensitively", () => {
    expect(names("", "rao")).toEqual(["BHEL-NCH", "MODEL-V"]);
    expect(names("", "clinic-f")).toEqual(["CLINIC-F"]);
    expect(names("", "PUNE")).toEqual(["MODEL-V"]);
    expect(names("", "mehta")).toEqual([]);
    expect(names("all", "mehta")).toEqual(["OLD-V"]);
  });
});

describe("parseProjectStatusFilter / normaliseProjectSearch", () => {
  it("accepts the known keys and falls back to the default otherwise", () => {
    expect(parseProjectStatusFilter("archived")).toBe("archived");
    expect(parseProjectStatusFilter("all")).toBe("all");
    expect(parseProjectStatusFilter(undefined)).toBe("");
    expect(parseProjectStatusFilter("Active")).toBe("");
  });

  it("trims and bounds the search", () => {
    expect(normaliseProjectSearch("  villa ")).toBe("villa");
    expect(normaliseProjectSearch(undefined)).toBe("");
    expect(normaliseProjectSearch("x".repeat(200))).toHaveLength(80);
  });
});
