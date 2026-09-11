import { describe, expect, it } from "vitest";
import { capResults, type SearchResultDTO } from "./service";

function row(category: SearchResultDTO["category"], n: number): SearchResultDTO {
  return { id: `${category}-${n}`, category, text: `${category} ${n}`, sub: "", href: "#" };
}

describe("capResults", () => {
  it("caps each category at 5", () => {
    const many = Array.from({ length: 10 }, (_, i) => row("Projects", i));
    const out = capResults({ Projects: many });
    expect(out.length).toBe(5);
  });

  it("caps the overall total at 25 even when every category is full", () => {
    const byCategory = Object.fromEntries(
      ["Projects", "Packages", "Stock Requests", "Approvals", "Bills", "Inventory", "Users"].map((c) => [
        c,
        Array.from({ length: 5 }, (_, i) => row(c as SearchResultDTO["category"], i)),
      ])
    );
    const out = capResults(byCategory);
    expect(out.length).toBe(25);
  });

  it("keeps the fixed category order regardless of input key order", () => {
    const out = capResults({
      Users: [row("Users", 1)],
      Projects: [row("Projects", 1)],
    });
    expect(out.map((r) => r.category)).toEqual(["Projects", "Users"]);
  });

  it("returns an empty array when nothing matched", () => {
    expect(capResults({})).toEqual([]);
  });

  it("omits a category entirely when it has no rows, without leaving a gap", () => {
    const out = capResults({ Projects: [row("Projects", 1)], Bills: [row("Bills", 1)] });
    expect(out.length).toBe(2);
    expect(out.map((r) => r.category)).toEqual(["Projects", "Bills"]);
  });
});
