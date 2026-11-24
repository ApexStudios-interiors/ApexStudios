import { beforeEach, describe, expect, it, vi } from "vitest";

/** enqueue(): through the RLS-scoped rpc_enqueue_job, then a drain kick (APX-20). */

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  kickDrain: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: h.rpc }) }));
vi.mock("./kick", () => ({ kickDrain: h.kickDrain }));

const { enqueue } = await import("./enqueue");

beforeEach(() => {
  h.rpc.mockReset();
  h.kickDrain.mockReset();
});

describe("enqueue", () => {
  it("enqueues through rpc_enqueue_job with the idempotency key, then kicks a drain", async () => {
    h.rpc.mockResolvedValue({ data: "job-1", error: null });
    const runAfter = new Date("2026-11-24T10:00:00Z");

    await expect(enqueue("bill.pdf", { billId: "b1" }, { idempotencyKey: "b1:r0", runAfter })).resolves.toBe(
      "job-1"
    );

    expect(h.rpc).toHaveBeenCalledWith("rpc_enqueue_job", {
      p_name: "bill.pdf",
      p_payload: { billId: "b1" },
      p_idempotency_key: "b1:r0",
      p_run_after: "2026-11-24T10:00:00.000Z",
    });
    expect(h.kickDrain).toHaveBeenCalledTimes(1);
  });

  it("throws an enqueue error and kicks nothing", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "FORBIDDEN: x is not an enqueueable job name" },
    });
    await expect(enqueue("x")).rejects.toThrow(/FORBIDDEN/);
    expect(h.kickDrain).not.toHaveBeenCalled();
  });
});
