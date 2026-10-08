import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * getBusinessInventory's role scoping, against a fake client that records
 * which view each read goes to — the part that decides what each role can
 * see at all: admin reads v_inventory_status (with unit cost and value),
 * site reads v_inventory_site (no money columns, and any that came back are
 * discarded), a client reads nothing. Also: the project filter and search
 * narrow the query itself, and the stat row's total value is admin-only.
 */

const h = vi.hoisted(() => ({
  views: [] as string[],
  selects: [] as string[],
  filters: [] as unknown[][],
  rows: [] as Record<string, unknown>[],
  stats: [{ total_items: 3, total_value: 98000, low_count: 1, critical_count: 1 }] as unknown[],
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: h.rpc,
    from: (table: string) => {
      if (table === "projects") {
        const chain = {
          select: () => chain,
          in: async () => ({
            data: [{ id: "00000000-0000-4000-8000-0000000000c1", name: "Tile House" }],
            error: null,
          }),
        };
        return chain;
      }
      h.views.push(table);
      const chain = {
        select: (cols: string) => (h.selects.push(cols), chain),
        order: () => chain,
        eq: (...a: unknown[]) => (h.filters.push(["eq", ...a]), chain),
        or: (...a: unknown[]) => (h.filters.push(["or", ...a]), chain),
        range: async () => ({ data: h.rows, count: h.rows.length, error: null }),
      };
      return chain;
    },
  }),
}));

const { getBusinessInventory } = await import("./queries");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

function sessionAs(role: Session["role"]): Session {
  return {
    userId: "00000000-0000-4000-8000-0000000000d5",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating: null,
  };
}

const ROW = {
  id: "00000000-0000-4000-8000-000000000601",
  project_id: PROJECT_ID,
  name: "Cement OPC 53",
  category: "Binders",
  sku: "CEM-53",
  unit: "bag",
  qty_on_hand: 4,
  reorder_level: 10,
  location: "Store A",
  unit_cost: 410,
  stock_value: 1640,
};

const PAGE = { page: 1, pageSize: 25 };

beforeEach(() => {
  h.views.length = 0;
  h.selects.length = 0;
  h.filters.length = 0;
  h.rows = [ROW];
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: h.stats, error: null });
});

describe("getBusinessInventory — what each role can see", () => {
  it("admin: v_inventory_status, with unit cost, stock value and total value", async () => {
    const { items, stats } = await getBusinessInventory(sessionAs("admin"), {}, PAGE);

    expect(h.views).toEqual(["v_inventory_status"]);
    expect(h.selects[0]).toContain("unit_cost");
    expect(items.rows[0]).toMatchObject({ unitCost: 410, stockValue: 1640, projectName: "Tile House" });
    expect(stats.totalValue).toBe(98000);
  });

  it("site: v_inventory_site — no money columns asked for, any returned are discarded, no total value", async () => {
    const { items, stats } = await getBusinessInventory(sessionAs("site"), {}, PAGE);

    expect(h.views).toEqual(["v_inventory_site"]);
    expect(h.selects[0]).not.toContain("unit_cost");
    expect(h.selects[0]).not.toContain("stock_value");
    expect(items.rows[0]).toMatchObject({ unitCost: null, stockValue: null });
    expect(stats.totalValue).toBeNull();
  });

  it("client: reads nothing at all", async () => {
    const { items, stats } = await getBusinessInventory(sessionAs("client"), {}, PAGE);

    expect(h.views).toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(items.rows).toEqual([]);
    expect(stats).toEqual({ totalItems: 0, totalValue: null, lowCount: 0, criticalCount: 0 });
  });

  it("narrows the query itself by project and search, and the stat row by the same", async () => {
    await getBusinessInventory(sessionAs("site"), { projectId: PROJECT_ID, search: "cement" }, PAGE);

    expect(h.filters).toContainEqual(["eq", "project_id", PROJECT_ID]);
    expect(h.filters.some((f) => f[0] === "or" && String(f[1]).includes("cement"))).toBe(true);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_inventory_stats", {
      p_project_id: PROJECT_ID,
      p_search: "cement",
    });
  });

  it("gives each item the SQL rule's status: critical at zero, low under the minimum, ok otherwise", async () => {
    h.rows = [
      { ...ROW, id: "a", qty_on_hand: 0, reorder_level: 10 },
      { ...ROW, id: "b", qty_on_hand: 4, reorder_level: 10 },
      { ...ROW, id: "c", qty_on_hand: 10, reorder_level: 10 },
    ];

    const { items } = await getBusinessInventory(sessionAs("site"), {}, PAGE);

    expect(items.rows.map((r) => r.status)).toEqual(["critical", "low", "ok"]);
  });

  it("names a central-store item's project as null", async () => {
    h.rows = [{ ...ROW, project_id: null }];

    const { items } = await getBusinessInventory(sessionAs("admin"), {}, PAGE);

    expect(items.rows[0]).toMatchObject({ projectId: null, projectName: null });
  });
});
