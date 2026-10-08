import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * transitionStockRequest end to end through next-safe-action, with the
 * session and the RLS-scoped client faked.
 *
 * What it pins down for migration 20261007090006: the action needs only `id`,
 * `project_id` and `status` from rpc_transition_stock_request — so the row a
 * non-admin now receives (rate and billed_on_bill_id nulled) serves it fully —
 * and it never passes the RPC's other columns on to its caller, whatever the
 * RPC returns. The RPC itself is tested against Postgres in
 * tests/integration/stock-and-inventory.test.ts.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {
    constructor(detail?: string) {
      super(detail ? `FORBIDDEN: ${detail}` : "FORBIDDEN");
    }
  }
  return {
    UnauthenticatedError,
    ForbiddenError,
    session: null as unknown as Session,
    rpc: vi.fn(),
    updateTag: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath, updateTag: h.updateTag }));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: async () => h.session,
  requireRole: async (roles: string[]) => {
    if (!roles.includes(h.session.role)) throw new h.ForbiddenError("role");
    return h.session;
  },
  requireProjectAccess: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: h.rpc }) }));
vi.mock("@/features/projects/actions", () => ({ getProjectRateVisibility: vi.fn() }));

const { transitionStockRequest } = await import("./actions");

const REQUEST_ID = "00000000-0000-4000-8000-0000000000f9";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

function sessionAs(role: Session["role"]) {
  h.session = {
    userId: "00000000-0000-4000-8000-0000000000d5",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "x",
    email: null,
    impersonating: null,
  };
}

/** The row as rpc_transition_stock_request returns it (a few columns). */
function row(over: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    project_id: PROJECT_ID,
    status: "delivered",
    material_name: "Cement",
    qty: 120,
    rate: null,
    billed_on_bill_id: null,
    ...over,
  };
}

beforeEach(() => {
  sessionAs("site");
  h.rpc.mockReset();
  h.updateTag.mockClear();
  h.revalidatePath.mockClear();
});

describe("transitionStockRequest", () => {
  it("works with the narrowed row a site supervisor now receives, returning { id, status }", async () => {
    h.rpc.mockResolvedValue({ data: row(), error: null });

    const result = await transitionStockRequest({ requestId: REQUEST_ID, toStatus: "delivered" });

    expect(result?.data).toEqual({ id: REQUEST_ID, status: "delivered" });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_transition_stock_request", {
      p_request_id: REQUEST_ID,
      p_to_status: "delivered",
      p_note: undefined,
    });
    expect(h.updateTag).toHaveBeenCalledWith(`project:${PROJECT_ID}`);
  });

  it("never passes rate or any other row column on to its caller, even for an admin", async () => {
    sessionAs("admin");
    h.rpc.mockResolvedValue({
      data: row({ status: "approved", rate: 410, billed_on_bill_id: "00000000-0000-4000-8000-000000000401" }),
      error: null,
    });

    const result = await transitionStockRequest({ requestId: REQUEST_ID, toStatus: "approved" });

    expect(result?.data).toEqual({ id: REQUEST_ID, status: "approved" });
    expect(Object.keys(result?.data ?? {}).sort()).toEqual(["id", "status"]);
  });

  it("refuses a client before the RPC is called", async () => {
    sessionAs("client");

    const result = await transitionStockRequest({ requestId: REQUEST_ID, toStatus: "delivered" });

    expect(result?.serverError).toBe("You don't have permission to do that.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("maps the RPC's refusal through the existing copy", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "ILLEGAL_TRANSITION: delivered to delivered is not a legal transition" },
    });

    const result = await transitionStockRequest({ requestId: REQUEST_ID, toStatus: "delivered" });

    expect(result?.serverError).toBe("This request has already moved on. Refresh to see the current status.");
  });
});
