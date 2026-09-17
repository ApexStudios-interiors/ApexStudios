import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * AGENTS.md database rule 7 — "soft delete only … every query filters
 * `deleted_at is null`" — for the stock reads, asserted on the query the
 * builder actually produces rather than on a database.
 *
 * The bug this guards against: the admin branches read the base tables
 * (`stock_requests`, `packages`, `profiles`) and had no `deleted_at` filter,
 * while the site branches read `v_stock_request_site` / `v_package_site`,
 * which carry the predicate in the view body (migration 0014). A soft-deleted
 * request was therefore invisible to a supervisor and still listed — and still
 * counted in the "N pending" subtitle — for an owner or admin.
 *
 * A live-data version of this belongs in tests/integration (it needs a real
 * soft-deleted row, and a real session per role); that suite has no target
 * while the only Supabase project is production (D49). This one runs anywhere.
 */

type Step = [method: string, args: unknown[]];
type RecordedQuery = { table: string; steps: Step[] };

const h = vi.hoisted(() => ({
  calls: [] as { table: string; steps: [string, unknown[]][] }[],
  rowsByTable: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const call = { table, steps: [] as [string, unknown[]][] };
      h.calls.push(call);
      const rows = () => h.rowsByTable[table] ?? [];
      const query: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(resolve({ data: rows(), count: rows().length, error: null })),
      };
      for (const method of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) {
        query[method] = (...args: unknown[]) => {
          call.steps.push([method, args]);
          return query;
        };
      }
      return query;
    },
  }),
}));

const { countStockRequests, getStockRequestsForProject, getStockRequestsPage } = await import("./queries");

const ORG = "00000000-0000-4000-8000-0000000000a0";
const PROJECT = "00000000-0000-4000-8000-0000000000c1";
const PACKAGE = "00000000-0000-4000-8000-0000000000b1";
const REQUESTER = "00000000-0000-4000-8000-0000000000d5";

function sessionAs(role: Session["role"]): Session {
  return { userId: REQUESTER, orgId: ORG, role, fullName: "x", email: null, impersonating: null };
}

/** Enough of a row that the follow-up package/profile lookups actually run. */
const stockRequestRow = {
  id: "00000000-0000-4000-8000-0000000000e1",
  ref_no: "SR-001",
  project_id: PROJECT,
  package_id: PACKAGE,
  material_name: "Cement",
  qty: 10,
  unit: "bag",
  rate: 380,
  needed_by: null,
  note: null,
  status: "pending",
  requested_by: REQUESTER,
  created_at: "2026-09-01T00:00:00Z",
  approved_at: null,
  ordered_at: null,
  delivered_at: null,
  rejected_reason: null,
};

/** Base tables carry `deleted_at`; the `v_*` views filter it in the view body. */
const SOFT_DELETED_BASE_TABLES = ["stock_requests", "packages", "profiles"];

function filtersDeletedAt(call: RecordedQuery): boolean {
  return call.steps.some(([method, args]) => method === "is" && args[0] === "deleted_at" && args[1] === null);
}

function tables(): string[] {
  return h.calls.map((c) => c.table);
}

function expectEveryBaseTableReadFiltersDeletedAt() {
  const base = h.calls.filter((c) => SOFT_DELETED_BASE_TABLES.includes(c.table));
  expect(base.length).toBeGreaterThan(0);
  expect(base.filter((c) => !filtersDeletedAt(c)).map((c) => c.table)).toEqual([]);
}

beforeEach(() => {
  h.calls.length = 0;
  h.rowsByTable = {
    stock_requests: [stockRequestRow],
    v_stock_request_site: [stockRequestRow],
    packages: [{ id: PACKAGE, name: "Kitchen", seq_no: 1 }],
    v_package_site: [{ id: PACKAGE, name: "Kitchen", seq_no: 1 }],
    profiles: [{ id: REQUESTER, full_name: "Ravi" }],
  };
});

describe("stock queries filter soft-deleted rows (AGENTS.md database rule 7)", () => {
  it("admin list reads stock_requests, packages and profiles with deleted_at is null", async () => {
    await getStockRequestsForProject(sessionAs("admin"), PROJECT);

    expect(tables()).toContain("stock_requests");
    expect(tables()).toContain("packages");
    expect(tables()).toContain("profiles");
    expectEveryBaseTableReadFiltersDeletedAt();
  });

  it("owner is the same admin path", async () => {
    await getStockRequestsForProject(sessionAs("owner"), PROJECT);
    expectEveryBaseTableReadFiltersDeletedAt();
  });

  it("the paginated admin list filters too — a soft-deleted row must not take up a slot", async () => {
    await getStockRequestsPage(sessionAs("admin"), PROJECT, {}, { page: 1, pageSize: 10 });
    expectEveryBaseTableReadFiltersDeletedAt();
  });

  it("the admin count filters too — the 'N pending' subtitle must not count deleted rows", async () => {
    await countStockRequests(sessionAs("admin"), PROJECT, { status: "pending" });

    const counted = h.calls.filter((c) => c.table === "stock_requests");
    expect(counted).toHaveLength(1);
    expect(counted.filter((c) => !filtersDeletedAt(c))).toEqual([]);
  });

  it("a site session reads the role-scoped views, which filter in the view body", async () => {
    await getStockRequestsForProject(sessionAs("site"), PROJECT);

    expect(tables()).toContain("v_stock_request_site");
    expect(tables()).toContain("v_package_site");
    expect(tables()).not.toContain("stock_requests");
    expect(tables()).not.toContain("packages");
    // profiles is a base table on both paths, so it still needs the filter.
    expectEveryBaseTableReadFiltersDeletedAt();
  });

  it("a client session reads nothing at all", async () => {
    expect(await getStockRequestsForProject(sessionAs("client"), PROJECT)).toEqual([]);
    expect(await countStockRequests(sessionAs("client"), PROJECT, {})).toBe(0);
    expect(h.calls).toEqual([]);
  });
});
