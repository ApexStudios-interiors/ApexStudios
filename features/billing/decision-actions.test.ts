import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The web's certifyBill / rejectBill through next-safe-action, with the
 * session and the RLS-scoped client faked — pinning that moving the RPC call
 * into ./transition.ts (shared with the mobile API) changed nothing for the
 * web: client only, the same RPC arguments, the same `{ id, status }` answer,
 * the same cache refresh, the reason still required and trimmed.
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
    env: { BILLING_ENABLED: true },
    rpc: vi.fn(),
    enqueue: vi.fn(),
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
vi.mock("@/lib/jobs/enqueue", () => ({ enqueue: h.enqueue }));
vi.mock("@/lib/r2/presign", () => ({ presignGet: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: h.env }));

const { certifyBill, rejectBill } = await import("./actions");

const BILL_ID = "00000000-0000-4000-8000-0000000000e1";
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

function row(status: string) {
  return { id: BILL_ID, project_id: PROJECT_ID, status, bill_no: "RA-1", revision: 2, margin_amount: 1 };
}

beforeEach(() => {
  sessionAs("client");
  h.env.BILLING_ENABLED = true;
  h.rpc.mockReset();
  h.enqueue.mockReset();
  h.updateTag.mockReset();
  h.revalidatePath.mockReset();
});

describe("certifyBill (web action)", () => {
  it("certifies via rpc_transition_bill, returns { id, status } and refreshes the project", async () => {
    h.rpc.mockResolvedValue({ data: row("certified"), error: null });

    const result = await certifyBill({ billId: BILL_ID, toStatus: "certified" });

    expect(result?.data).toEqual({ id: BILL_ID, status: "certified" });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_transition_bill", {
      p_bill_id: BILL_ID,
      p_to_status: "certified",
      p_note: undefined,
    });
    expect(h.updateTag).toHaveBeenCalledWith(`project:${PROJECT_ID}`);
    expect(h.revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT_ID}`, "layout");
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("refuses an admin before the RPC", async () => {
    sessionAs("admin");

    const result = await certifyBill({ billId: BILL_ID, toStatus: "certified" });

    expect(result?.data).toBeUndefined();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses while BILLING_ENABLED is off, before the RPC", async () => {
    h.env.BILLING_ENABLED = false;

    const result = await certifyBill({ billId: BILL_ID, toStatus: "certified" });

    expect(result?.serverError).toBeTruthy();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("rejectBill (web action)", () => {
  it("sends the trimmed reason as the note of a move to draft", async () => {
    h.rpc.mockResolvedValue({ data: row("draft"), error: null });

    const result = await rejectBill({ billId: BILL_ID, reason: "  Wrong rate  " });

    expect(result?.data).toEqual({ id: BILL_ID, status: "draft" });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_transition_bill", {
      p_bill_id: BILL_ID,
      p_to_status: "draft",
      p_note: "Wrong rate",
    });
  });

  it("requires a reason (whitespace only is none), before the RPC", async () => {
    const result = await rejectBill({ billId: BILL_ID, reason: "   " });

    expect(result?.validationErrors).toBeTruthy();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
