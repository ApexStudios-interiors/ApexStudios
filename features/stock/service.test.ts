import { describe, expect, it } from "vitest";
import { availableTransitions, type StockRequestStatus } from "./service";
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
