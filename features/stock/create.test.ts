import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import type { RateVisibility } from "@/features/projects/service";
import type { CreateStockRequestInput } from "./schema";

/**
 * createStockRequestFor — the shared write path for the web action and the
 * mobile API — with the RLS-scoped client and the project's rate_visibility
 * faked. What it pins down: the D55 rate rule (admin always keeps a rate;
 * site only where the project is 'editable'), every input mapped to the RPC
 * argument it always went to, the `{ id, refNo }` result, and the RPC's own
 * error passed through unchanged for the caller's mapDomainError.
 * `rpc_create_stock_request` itself is tested against Postgres in
 * tests/integration/stock-and-inventory.test.ts.
 */

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  rateVisibility: "hidden" as RateVisibility,
  getProjectRateVisibility: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: h.rpc }) }));
vi.mock("@/features/projects/actions", () => ({ getProjectRateVisibility: h.getProjectRateVisibility }));

const { createStockRequestFor } = await import("./create");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

function sessionAs(role: Session["role"]): Session {
  return {
    userId: "00000000-0000-4000-8000-0000000000d1",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating: null,
  };
}

const INPUT: CreateStockRequestInput = {
  projectId: PROJECT_ID,
  packageId: "00000000-0000-4000-8000-0000000000e1",
  phaseId: "00000000-0000-4000-8000-0000000000f1",
  inventoryItemId: undefined,
  materialName: "Cement",
  qty: 120,
  unit: "bag",
  rate: 410,
  neededBy: "2026-10-20",
  note: "For the deck",
};

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: { id: "sr-1", ref_no: "SR-BHEL-NCH-014" }, error: null });
  h.getProjectRateVisibility.mockReset();
  h.getProjectRateVisibility.mockImplementation(async () => h.rateVisibility);
});

/** The p_rate the RPC was called with. */
function sentRate() {
  return (h.rpc.mock.calls[0]?.[1] as { p_rate?: number }).p_rate;
}

describe("createStockRequestFor", () => {
  it("maps every input to its RPC argument and returns { id, refNo }", async () => {
    const result = await createStockRequestFor(sessionAs("admin"), INPUT);

    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_create_stock_request", {
      p_project_id: INPUT.projectId,
      p_package_id: INPUT.packageId,
      p_material_name: "Cement",
      p_qty: 120,
      p_unit: "bag",
      p_phase_id: INPUT.phaseId,
      p_inventory_item_id: undefined,
      p_rate: 410,
      p_needed_by: "2026-10-20",
      p_note: "For the deck",
    });
    expect(result).toEqual({ id: "sr-1", refNo: "SR-BHEL-NCH-014" });
  });

  it("keeps an admin's rate without consulting the project's rate visibility", async () => {
    h.rateVisibility = "hidden";

    await createStockRequestFor(sessionAs("admin"), INPUT);

    expect(sentRate()).toBe(410);
    expect(h.getProjectRateVisibility).not.toHaveBeenCalled();
  });

  it("keeps a site supervisor's rate where the project is 'editable'", async () => {
    h.rateVisibility = "editable";

    await createStockRequestFor(sessionAs("site"), INPUT);

    expect(h.getProjectRateVisibility).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
    expect(sentRate()).toBe(410);
  });

  it.each(["hidden", "readonly"] as const)(
    "strips a site supervisor's rate where the project is '%s'",
    async (visibility) => {
      h.rateVisibility = visibility;

      await createStockRequestFor(sessionAs("site"), INPUT);

      expect(sentRate()).toBeUndefined();
      // Everything else is still sent untouched.
      expect(h.rpc.mock.calls[0]?.[1]).toMatchObject({ p_material_name: "Cement", p_qty: 120 });
    }
  );

  it("uses the REAL role, not an admin's preview role", async () => {
    h.rateVisibility = "hidden";
    const previewing: Session = {
      ...sessionAs("admin"),
      impersonating: { role: "site", projectId: PROJECT_ID },
    };

    await createStockRequestFor(previewing, INPUT);

    expect(sentRate()).toBe(410);
  });

  it("throws the RPC's own error message unchanged", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "NOT_FOUND: package x does not exist in this project" },
    });

    await expect(createStockRequestFor(sessionAs("site"), INPUT)).rejects.toThrow(
      "NOT_FOUND: package x does not exist in this project"
    );
  });
});
