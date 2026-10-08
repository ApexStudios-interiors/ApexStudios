import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * adjustInventoryFor — the shared write for the web action and the mobile
 * API — with the RLS-scoped client faked. What it pins down: the item is read
 * through the caller's own RLS first (an item they cannot see is NOT_FOUND,
 * with nothing written); the ONLY write is rpc_adjust_inventory, called with
 * exactly the validated input — so its stock movement, reason and `adjust`
 * audit row are the RPC's own, unchanged; the result carries the new
 * quantity, the minimum stock and the SQL rule's status; and the RPC's own
 * errors are thrown unchanged. The RPC is tested against Postgres in
 * tests/integration/stock-and-inventory.test.ts.
 */

const h = vi.hoisted(() => ({
  item: { data: null as unknown, error: null as { message: string } | null },
  rpc: vi.fn(),
  calls: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: h.rpc,
    from: (table: string) => {
      h.calls.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => (h.calls.push(["select", ...a]), chain),
        eq: (...a: unknown[]) => (h.calls.push(["eq", ...a]), chain),
        is: (...a: unknown[]) => (h.calls.push(["is", ...a]), chain),
        maybeSingle: async () => h.item,
        insert: () => {
          throw new Error("adjustInventoryFor must not write a table directly");
        },
        update: () => {
          throw new Error("adjustInventoryFor must not write a table directly");
        },
      };
      return chain;
    },
  }),
}));

const { adjustInventoryFor } = await import("./adjust");

const ITEM_ID = "00000000-0000-4000-8000-000000000601";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

const SESSION: Session = {
  userId: "00000000-0000-4000-8000-0000000000d2",
  orgId: "00000000-0000-4000-8000-0000000000a0",
  role: "admin",
  fullName: "Test Admin",
  email: null,
  impersonating: null,
};

/** The full row the RPC returns. */
function row(qty: number, reorder = 10) {
  return {
    id: ITEM_ID,
    org_id: SESSION.orgId,
    project_id: PROJECT_ID,
    name: "Cement OPC 53",
    unit: "bag",
    qty_on_hand: qty,
    reorder_level: reorder,
    unit_cost: 410,
  };
}

beforeEach(() => {
  h.item = { data: { id: ITEM_ID }, error: null };
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: row(25), error: null });
  h.calls.length = 0;
});

describe("adjustInventoryFor", () => {
  it("reads the item through the caller's RLS, then adjusts it with the RPC — the only write", async () => {
    await adjustInventoryFor(SESSION, { itemId: ITEM_ID, newQty: 25, reason: "Stock count" });

    expect(h.calls).toEqual([
      ["from", "inventory_items"],
      ["select", "id"],
      ["eq", "id", ITEM_ID],
      ["is", "deleted_at", null],
    ]);
    // The movement, the reason and the audit row are the RPC's own.
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_adjust_inventory", {
      p_item_id: ITEM_ID,
      p_new_qty: 25,
      p_reason: "Stock count",
    });
  });

  it("returns the new quantity, the minimum stock and the SQL rule's status", async () => {
    const result = await adjustInventoryFor(SESSION, { itemId: ITEM_ID, newQty: 25, reason: "Stock count" });

    expect(result).toEqual({
      id: ITEM_ID,
      projectId: PROJECT_ID,
      qtyOnHand: 25,
      reorderLevel: 10,
      status: "ok",
    });
  });

  it.each([
    [0, "critical"],
    [4, "low"],
    [10, "ok"],
  ] as const)("gives a new quantity of %i the status %s", async (qty, status) => {
    h.rpc.mockResolvedValue({ data: row(qty), error: null });

    const result = await adjustInventoryFor(SESSION, { itemId: ITEM_ID, newQty: qty, reason: "Recount" });

    expect(result.status).toBe(status);
  });

  it("reads numeric columns sent as strings as numbers", async () => {
    h.rpc.mockResolvedValue({ data: { ...row(0), qty_on_hand: "12.500", reorder_level: "10" }, error: null });

    const result = await adjustInventoryFor(SESSION, { itemId: ITEM_ID, newQty: 12.5, reason: "Recount" });

    expect(result).toMatchObject({ qtyOnHand: 12.5, reorderLevel: 10, status: "ok" });
  });

  it("refuses an item the caller cannot see (another org, a project they are not on) with NOT_FOUND, writing nothing", async () => {
    h.item = { data: null, error: null };

    await expect(
      adjustInventoryFor(SESSION, { itemId: ITEM_ID, newQty: 25, reason: "Stock count" })
    ).rejects.toThrow("NOT_FOUND: this inventory item no longer exists");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([
    "FORBIDDEN: rpc_adjust_inventory is admin-only",
    "REASON_REQUIRED: a reason is required to adjust inventory",
    "REASON_REQUIRED: quantity cannot be negative",
    `NOT_FOUND: inventory item ${ITEM_ID} does not exist`,
  ])("throws the RPC's error unchanged: %s", async (message) => {
    h.rpc.mockResolvedValue({ data: null, error: { message } });

    await expect(
      adjustInventoryFor(SESSION, { itemId: ITEM_ID, newQty: 25, reason: "Stock count" })
    ).rejects.toThrow(message);
  });

  it("throws the item lookup's own error unchanged, writing nothing", async () => {
    h.item = { data: null, error: { message: "inventory lookup failed" } };

    await expect(
      adjustInventoryFor(SESSION, { itemId: ITEM_ID, newQty: 25, reason: "Stock count" })
    ).rejects.toThrow("inventory lookup failed");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
