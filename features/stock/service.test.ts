import { describe, expect, it } from "vitest";
import {
  availableTransitions,
  isDeadlineAtRisk,
  isDuplicateOfDelivered,
  normalizeMaterialName,
  subtractBusinessDays,
  type StockRequestStatus,
} from "./service";
import type { Role } from "@/lib/rbac/roles";

/** build/07-stock-inventory-notifications.md §3: "twenty cases, all asserted"
 *  — 5 statuses × 4 roles, each spelled out rather than looped, so a future
 *  change to one cell shows up as a diff on that exact line. */
describe("availableTransitions", () => {
  const cases: { status: StockRequestStatus; role: Role; expected: string[] }[] = [
    { status: "pending", role: "owner", expected: ["approved", "rejected"] },
    { status: "pending", role: "admin", expected: ["approved", "rejected"] },
    { status: "pending", role: "site", expected: [] },
    { status: "pending", role: "client", expected: [] },

    { status: "approved", role: "owner", expected: ["ordered"] },
    { status: "approved", role: "admin", expected: ["ordered"] },
    { status: "approved", role: "site", expected: [] },
    { status: "approved", role: "client", expected: [] },

    { status: "ordered", role: "owner", expected: ["delivered"] },
    { status: "ordered", role: "admin", expected: ["delivered"] },
    { status: "ordered", role: "site", expected: ["delivered"] },
    { status: "ordered", role: "client", expected: [] },

    { status: "delivered", role: "owner", expected: [] },
    { status: "delivered", role: "admin", expected: [] },
    { status: "delivered", role: "site", expected: [] },
    { status: "delivered", role: "client", expected: [] },

    { status: "rejected", role: "owner", expected: [] },
    { status: "rejected", role: "admin", expected: [] },
    { status: "rejected", role: "site", expected: [] },
    { status: "rejected", role: "client", expected: [] },
  ];

  it.each(cases)("$status / $role -> $expected", ({ status, role, expected }) => {
    expect(availableTransitions(status, role).map((t) => t.to)).toEqual(expected);
  });

  it("covers all twenty status × role combinations", () => {
    expect(cases.length).toBe(20);
  });
});

/**
 * Business days are Monday–Friday and there is NO public-holiday calendar
 * (see `subtractBusinessDays`' own comment) — nothing here asserts a holiday
 * is skipped, because nothing skips one.
 *
 * Reference week, all 2026: Fri 18th, Sat 19th, Sun 20th, Mon 21st, Tue 22nd,
 * Wed 23rd, Thu 24th, Fri 25th, Sat 26th, Sun 27th, Mon 28th.
 */
describe("subtractBusinessDays", () => {
  const cases: [string, number, string][] = [
    // Two business days before a Monday is the Thursday before it — the
    // weekend in between is not counted.
    ["2026-09-28", 2, "2026-09-24"],
    // …and before a Tuesday it reaches back across the weekend to the Friday.
    ["2026-09-22", 2, "2026-09-18"],
    // Plain mid-week, no weekend crossed at all.
    ["2026-09-25", 2, "2026-09-23"],
    // A needed-by date that itself falls on a weekend still counts back from
    // the preceding Friday.
    ["2026-09-26", 2, "2026-09-24"],
    ["2026-09-27", 2, "2026-09-24"],
    // One business day, and five (a whole working week).
    ["2026-09-21", 1, "2026-09-18"],
    ["2026-09-28", 5, "2026-09-21"],
    // Across a month and a year boundary.
    ["2026-01-01", 2, "2025-12-30"],
    ["2026-03-02", 2, "2026-02-26"],
  ];

  it.each(cases)("%s minus %i business days is %s", (from, days, expected) => {
    expect(subtractBusinessDays(from, days)).toBe(expected);
  });

  it("returns the date unchanged for a zero or negative count", () => {
    expect(subtractBusinessDays("2026-09-28", 0)).toBe("2026-09-28");
    expect(subtractBusinessDays("2026-09-28", -3)).toBe("2026-09-28");
  });

  it("returns a malformed value unchanged rather than inventing a date", () => {
    expect(subtractBusinessDays("", 2)).toBe("");
    expect(subtractBusinessDays("28/09/2026", 2)).toBe("28/09/2026");
    expect(subtractBusinessDays("2026-9-28", 2)).toBe("2026-9-28");
  });

  /** The arithmetic is on the calendar, not on the host clock: the same
   *  answer east and west of UTC. A local-midnight `Date` would shift a day. */
  describe.each(["Asia/Kolkata", "America/Los_Angeles", "UTC"])("under TZ=%s", (tz) => {
    it("gives the same answer", () => {
      const original = process.env.TZ;
      process.env.TZ = tz;
      try {
        expect(subtractBusinessDays("2026-09-28", 2)).toBe("2026-09-24");
      } finally {
        process.env.TZ = original;
      }
    });
  });
});

describe("isDeadlineAtRisk", () => {
  // Needed by Monday 28 Sep 2026; two business days before it is Thursday
  // the 24th.
  const neededBy = "2026-09-28";

  it("is not at risk three business days out", () => {
    expect(isDeadlineAtRisk("pending", neededBy, "2026-09-23")).toBe(false);
  });

  it("turns red exactly two business days before the date", () => {
    expect(isDeadlineAtRisk("pending", neededBy, "2026-09-24")).toBe(true);
  });

  it("stays red over the intervening weekend and on the day itself", () => {
    expect(isDeadlineAtRisk("pending", neededBy, "2026-09-25")).toBe(true);
    expect(isDeadlineAtRisk("pending", neededBy, "2026-09-26")).toBe(true);
    expect(isDeadlineAtRisk("pending", neededBy, "2026-09-28")).toBe(true);
  });

  it("stays red once the date has passed", () => {
    expect(isDeadlineAtRisk("pending", neededBy, "2026-10-15")).toBe(true);
  });

  it.each<StockRequestStatus>(["approved", "ordered", "delivered", "rejected"])(
    "is never at risk once the request is %s",
    (status) => {
      expect(isDeadlineAtRisk(status, neededBy, "2026-10-15")).toBe(false);
    }
  );

  it("is never at risk without a needed-by date", () => {
    expect(isDeadlineAtRisk("pending", null, "2026-10-15")).toBe(false);
    expect(isDeadlineAtRisk("pending", undefined, "2026-10-15")).toBe(false);
    expect(isDeadlineAtRisk("pending", "", "2026-10-15")).toBe(false);
  });

  it("is never at risk on a malformed date on either side", () => {
    expect(isDeadlineAtRisk("pending", "28/09/2026", "2026-10-15")).toBe(false);
    expect(isDeadlineAtRisk("pending", neededBy, "not-a-date")).toBe(false);
  });
});

describe("normalizeMaterialName", () => {
  it("trims, case-folds and collapses inner whitespace", () => {
    expect(normalizeMaterialName("  Cement  OPC 53 ")).toBe("cement opc 53");
    expect(normalizeMaterialName("CEMENT OPC 53")).toBe(normalizeMaterialName("cement opc 53"));
  });
});

describe("isDuplicateOfDelivered", () => {
  const delivered = {
    inventoryItemId: "11111111-1111-4111-8111-111111111111",
    materialName: "Cement OPC 53",
    qty: 100,
    neededBy: "2026-10-01",
  };

  it("matches the same material name, quantity and needed-by date", () => {
    expect(
      isDuplicateOfDelivered({ materialName: "Cement OPC 53", qty: 100, neededBy: "2026-10-01" }, delivered)
    ).toBe(true);
  });

  it("matches a name that differs only by case and spacing", () => {
    expect(
      isDuplicateOfDelivered(
        { materialName: "  cement   opc 53 ", qty: 100, neededBy: "2026-10-01" },
        delivered
      )
    ).toBe(true);
  });

  it("does not match a different quantity, with no tolerance", () => {
    expect(
      isDuplicateOfDelivered({ materialName: "Cement OPC 53", qty: 100.5, neededBy: "2026-10-01" }, delivered)
    ).toBe(false);
  });

  it("does not match a different needed-by date", () => {
    expect(
      isDuplicateOfDelivered({ materialName: "Cement OPC 53", qty: 100, neededBy: "2026-10-02" }, delivered)
    ).toBe(false);
  });

  it("never matches when either side has no needed-by date", () => {
    expect(isDuplicateOfDelivered({ materialName: "Cement OPC 53", qty: 100 }, delivered)).toBe(false);
    expect(
      isDuplicateOfDelivered(
        { materialName: "Cement OPC 53", qty: 100, neededBy: "2026-10-01" },
        { ...delivered, neededBy: null }
      )
    ).toBe(false);
  });

  it("does not match a genuinely different material", () => {
    expect(
      isDuplicateOfDelivered({ materialName: "Cement PPC", qty: 100, neededBy: "2026-10-01" }, delivered)
    ).toBe(false);
  });

  /** The linked inventory item is an identity, the name only a spelling —
   *  so when the new request carries one, it decides, and the name is not
   *  consulted at all. */
  it("prefers the linked inventory item when the new request has one", () => {
    expect(
      isDuplicateOfDelivered(
        {
          inventoryItemId: delivered.inventoryItemId,
          materialName: "Cement (53 grade), OPC",
          qty: 100,
          neededBy: "2026-10-01",
        },
        delivered
      )
    ).toBe(true);

    expect(
      isDuplicateOfDelivered(
        {
          inventoryItemId: "22222222-2222-4222-8222-222222222222",
          materialName: "Cement OPC 53",
          qty: 100,
          neededBy: "2026-10-01",
        },
        delivered
      )
    ).toBe(false);
  });

  it("falls back to the name when the delivered row has no linked item", () => {
    expect(
      isDuplicateOfDelivered(
        { materialName: "Cement OPC 53", qty: 100, neededBy: "2026-10-01" },
        { ...delivered, inventoryItemId: null }
      )
    ).toBe(true);
  });
});
