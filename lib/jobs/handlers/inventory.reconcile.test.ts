import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * inventory.reconcile alerts and never corrects (build/07 §5): drift is
 * logged per item and the job THROWS, so it lands on the Failed Jobs page.
 */

type Result = { data: unknown; error: { message: string } | null };

const h = vi.hoisted(() => ({
  result: { data: [], error: null } as Result,
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string) => {
      h.rpc(name);
      return Promise.resolve(h.result);
    },
    // Anything else would be a correction of the cache — there must be none.
    from: () => {
      throw new Error("reconcile must not write to any table");
    },
  }),
}));

const { reconcileInventory } = await import("./inventory.reconcile");

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.result = { data: [], error: null };
  h.rpc.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("inventory.reconcile", () => {
  it("returns quietly when the cache matches the ledger", async () => {
    await expect(reconcileInventory()).resolves.toBeUndefined();
    expect(h.rpc).toHaveBeenCalledWith("rpc_inventory_drift");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("logs every drifting item and throws DRIFT_DETECTED", async () => {
    h.result = {
      data: [
        { item_id: "i1", name: "Cement", cached_qty: 10, ledger_qty: 8 },
        { item_id: "i2", name: "Sand", cached_qty: 5, ledger_qty: 6 },
      ],
      error: null,
    };
    await expect(reconcileInventory()).rejects.toThrow(/^DRIFT_DETECTED: 2 inventory item/);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("Cement");
  });

  it("throws the database error when the drift query fails", async () => {
    h.result = { data: null, error: { message: "rpc failed" } };
    await expect(reconcileInventory()).rejects.toThrow("rpc failed");
  });
});
