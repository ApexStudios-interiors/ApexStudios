import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * transitionBillFor — the shared bill transition for the web actions
 * (transitionBill / certifyBill / rejectBill) and the mobile API — with the
 * RLS-scoped client faked. What it pins down: the input reaches
 * rpc_transition_bill argument for argument; only `{ id, status, projectId }`
 * comes back whatever the RPC returns (never internal cost or margin); the
 * PDF render is enqueued on submit only, keyed per (bill, revision); the
 * RPC's own error is thrown unchanged for the caller's mapDomainError; and
 * nothing here refreshes the web cache.
 */

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  enqueue: vi.fn(),
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ updateTag: h.updateTag, revalidatePath: h.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: h.rpc }) }));
vi.mock("@/lib/jobs/enqueue", () => ({ enqueue: h.enqueue }));

const { transitionBillFor } = await import("./transition");

const BILL_ID = "00000000-0000-4000-8000-0000000000e1";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

const SESSION: Session = {
  userId: "00000000-0000-4000-8000-0000000000d5",
  orgId: "00000000-0000-4000-8000-0000000000a0",
  role: "client",
  fullName: "Test User",
  email: null,
  impersonating: null,
};

/** The full bills row the RPC returns — more than any caller should see. */
function rpcRow(status: string, revision = 1) {
  return {
    id: BILL_ID,
    project_id: PROJECT_ID,
    status,
    bill_no: "RA-APX-001",
    revision,
    internal_cost_amount: 90000,
    margin_amount: 25000,
    net_payable: 126800,
  };
}

beforeEach(() => {
  h.rpc.mockReset();
  h.enqueue.mockReset();
  h.enqueue.mockResolvedValue("job-id");
  h.updateTag.mockReset();
  h.revalidatePath.mockReset();
});

describe("transitionBillFor", () => {
  it("certifies through rpc_transition_bill and returns only id, status and project", async () => {
    h.rpc.mockResolvedValue({ data: rpcRow("certified"), error: null });

    const moved = await transitionBillFor(SESSION, { billId: BILL_ID, toStatus: "certified" });

    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_transition_bill", {
      p_bill_id: BILL_ID,
      p_to_status: "certified",
      p_note: undefined,
    });
    expect(moved).toEqual({ id: BILL_ID, status: "certified", projectId: PROJECT_ID });
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("rejects with the reason as the RPC's note, and enqueues nothing", async () => {
    h.rpc.mockResolvedValue({ data: rpcRow("draft", 2), error: null });

    const moved = await transitionBillFor(SESSION, {
      billId: BILL_ID,
      toStatus: "draft",
      note: "Wrong rate",
    });

    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_transition_bill", {
      p_bill_id: BILL_ID,
      p_to_status: "draft",
      p_note: "Wrong rate",
    });
    expect(moved).toEqual({ id: BILL_ID, status: "draft", projectId: PROJECT_ID });
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("enqueues the PDF render on submit, keyed per bill and revision (unchanged web behaviour)", async () => {
    h.rpc.mockResolvedValue({ data: rpcRow("submitted", 3), error: null });

    await transitionBillFor(SESSION, { billId: BILL_ID, toStatus: "submitted" });

    expect(h.enqueue).toHaveBeenCalledExactlyOnceWith(
      "bill.pdf",
      { billId: BILL_ID },
      { idempotencyKey: `${BILL_ID}:submitted:r3` }
    );
  });

  it("throws the RPC's own error unchanged", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "ILLEGAL_TRANSITION: certified to certified is not a legal transition" },
    });

    await expect(transitionBillFor(SESSION, { billId: BILL_ID, toStatus: "certified" })).rejects.toThrow(
      "ILLEGAL_TRANSITION: certified to certified is not a legal transition"
    );
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("never refreshes the web cache — that stays the web action's job", async () => {
    h.rpc.mockResolvedValue({ data: rpcRow("certified"), error: null });

    await transitionBillFor(SESSION, { billId: BILL_ID, toStatus: "certified" });

    expect(h.updateTag).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});
