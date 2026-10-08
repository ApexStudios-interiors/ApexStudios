import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import type { TransitionStockRequestInput } from "./schema";

/**
 * transitionStockRequestFor — the shared transition path for the web action
 * and the mobile API — with the RLS-scoped client faked. What it pins down:
 * the validated input reaches rpc_transition_stock_request argument for
 * argument, only `{ id, status, projectId }` comes back whatever the RPC
 * returns (never rate, billed_on_bill_id or any other column), the RPC's own
 * error is thrown unchanged for the caller's mapDomainError, and nothing here
 * refreshes the web cache. The web action around it is
 * ./transition-action.test.ts; the RPC itself is tested against Postgres in
 * tests/integration/stock-and-inventory.test.ts.
 */

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ updateTag: h.updateTag, revalidatePath: h.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: h.rpc }) }));

const { transitionStockRequestFor } = await import("./transition");

const REQUEST_ID = "00000000-0000-4000-8000-0000000000f9";
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

/** The full row the RPC returns — more than any caller should see. */
function rpcRow(status: string, over: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    project_id: PROJECT_ID,
    status,
    ref_no: "SR-BHEL-NCH-014",
    material_name: "Cement",
    qty: 120,
    rate: 410,
    billed_on_bill_id: "00000000-0000-4000-8000-000000000401",
    inventory_item_id: "00000000-0000-4000-8000-000000000601",
    rejected_reason: null,
    ...over,
  };
}

beforeEach(() => {
  h.rpc.mockReset();
  h.updateTag.mockClear();
  h.revalidatePath.mockClear();
});

describe("transitionStockRequestFor", () => {
  it("returns { id, status, projectId } for a successful transition", async () => {
    h.rpc.mockResolvedValue({ data: rpcRow("approved"), error: null });

    const result = await transitionStockRequestFor(sessionAs("admin"), {
      requestId: REQUEST_ID,
      toStatus: "approved",
    });

    expect(result).toEqual({ id: REQUEST_ID, status: "approved", projectId: PROJECT_ID });
  });

  it.each<[string, TransitionStockRequestInput, Record<string, unknown>]>([
    [
      "an approval",
      { requestId: REQUEST_ID, toStatus: "approved" },
      { p_request_id: REQUEST_ID, p_to_status: "approved", p_note: undefined },
    ],
    [
      "a rejection, with its reason",
      { requestId: REQUEST_ID, toStatus: "rejected", note: "Vendor cannot supply this spec" },
      { p_request_id: REQUEST_ID, p_to_status: "rejected", p_note: "Vendor cannot supply this spec" },
    ],
    [
      "a delivery",
      { requestId: REQUEST_ID, toStatus: "delivered" },
      { p_request_id: REQUEST_ID, p_to_status: "delivered", p_note: undefined },
    ],
  ])("passes %s to the RPC argument for argument", async (_label, input, expected) => {
    h.rpc.mockResolvedValue({ data: rpcRow(input.toStatus), error: null });

    await transitionStockRequestFor(sessionAs("admin"), input);

    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_transition_stock_request", expected);
  });

  it("never returns rate, billed_on_bill_id or any other column of the row", async () => {
    h.rpc.mockResolvedValue({ data: rpcRow("approved"), error: null });

    const result = await transitionStockRequestFor(sessionAs("admin"), {
      requestId: REQUEST_ID,
      toStatus: "approved",
    });

    expect(Object.keys(result).sort()).toEqual(["id", "projectId", "status"]);
    expect(result).not.toHaveProperty("rate");
    expect(result).not.toHaveProperty("billed_on_bill_id");
  });

  it("returns a rejection as rejected — the reason stays with the RPC", async () => {
    h.rpc.mockResolvedValue({ data: rpcRow("rejected", { rejected_reason: "Wrong spec" }), error: null });

    const result = await transitionStockRequestFor(sessionAs("admin"), {
      requestId: REQUEST_ID,
      toStatus: "rejected",
      note: "Wrong spec",
    });

    expect(result).toEqual({ id: REQUEST_ID, status: "rejected", projectId: PROJECT_ID });
  });

  it("returns a site supervisor's delivery as delivered, from the narrowed row", async () => {
    // What a non-admin receives once 20261007090006 is applied.
    h.rpc.mockResolvedValue({
      data: rpcRow("delivered", { rate: null, billed_on_bill_id: null }),
      error: null,
    });

    const result = await transitionStockRequestFor(sessionAs("site"), {
      requestId: REQUEST_ID,
      toStatus: "delivered",
    });

    expect(result).toEqual({ id: REQUEST_ID, status: "delivered", projectId: PROJECT_ID });
  });

  it.each([
    "ILLEGAL_TRANSITION: delivered to delivered is not a legal transition",
    "REASON_REQUIRED: a reason is required to reject a request",
    "FORBIDDEN: requires admin",
    `FORBIDDEN: not a member of project ${PROJECT_ID}`,
    `NOT_FOUND: stock request ${REQUEST_ID} does not exist`,
    'relation "stock_requests" does not exist',
  ])("throws the RPC's error unchanged: %s", async (message) => {
    h.rpc.mockResolvedValue({ data: null, error: { message } });

    await expect(
      transitionStockRequestFor(sessionAs("admin"), { requestId: REQUEST_ID, toStatus: "approved" })
    ).rejects.toThrow(message);
  });

  it("does not refresh the web cache — that is the web action's job", async () => {
    h.rpc.mockResolvedValue({ data: rpcRow("ordered"), error: null });

    await transitionStockRequestFor(sessionAs("admin"), { requestId: REQUEST_ID, toStatus: "ordered" });

    expect(h.updateTag).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});
