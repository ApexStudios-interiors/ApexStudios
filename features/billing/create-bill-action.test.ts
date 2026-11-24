import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * createBill (web action) — APX-22: the bill date is always today in
 * Asia/Kolkata, stamped by the server, never the database's UTC current_date
 * and never a date from the browser; the optional billing period passes
 * through, both or neither. Plus recordPayment's paise rule (APX-60).
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    session: null as unknown as Session,
    env: { BILLING_ENABLED: true },
    rpc: vi.fn(),
    today: vi.fn(() => "2026-04-01"),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: async () => h.session,
  requireRole: async (roles: string[]) => {
    if (!roles.includes(h.session.role)) throw new h.ForbiddenError("FORBIDDEN");
    return h.session;
  },
  requireProjectAccess: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: h.rpc }) }));
vi.mock("@/lib/jobs/enqueue", () => ({ enqueue: vi.fn() }));
vi.mock("@/lib/r2/presign", () => ({ presignGet: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/dates", () => ({ todayIst: h.today }));

const { createBill, recordPayment } = await import("./actions");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const PHASE_ID = "00000000-0000-4000-8000-0000000000f1";
const BILL_ID = "00000000-0000-4000-8000-0000000000e1";

beforeEach(() => {
  h.session = {
    userId: "00000000-0000-4000-8000-0000000000d2",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role: "admin",
    fullName: "x",
    email: null,
    impersonating: null,
  };
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: { id: BILL_ID, bill_no: "RA-1", project_id: PROJECT_ID }, error: null });
});

const base = {
  projectId: PROJECT_ID,
  lines: [{ sourceType: "phase" as const, sourceId: PHASE_ID }],
  idempotencyKey: "00000000-0000-4000-8000-000000000099",
};

describe("createBill — APX-22", () => {
  it("always passes today's IST date as p_bill_date", async () => {
    const result = await createBill(base);
    expect(result?.data).toEqual({ id: BILL_ID, refNo: "RA-1" });
    expect(h.rpc).toHaveBeenCalledWith(
      "rpc_create_bill",
      expect.objectContaining({ p_bill_date: "2026-04-01", p_period_from: undefined, p_period_to: undefined })
    );
  });

  it("ignores any billDate the browser sends", async () => {
    await createBill({ ...base, billDate: "2025-03-31" } as typeof base);
    expect(h.rpc.mock.calls[0]?.[1]).toMatchObject({ p_bill_date: "2026-04-01" });
  });

  it("passes the billing period through", async () => {
    await createBill({ ...base, periodFrom: "2026-03-01", periodTo: "2026-03-31" });
    expect(h.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_period_from: "2026-03-01",
      p_period_to: "2026-03-31",
    });
  });

  it.each([
    [{ periodFrom: "2026-03-01" }, "only a start"],
    [{ periodTo: "2026-03-31" }, "only an end"],
    [{ periodFrom: "2026-03-31", periodTo: "2026-03-01" }, "start after end"],
  ])("refuses %j (%s) before reaching the database", async (period: Record<string, string>, _why: string) => {
    void _why;
    const result = await createBill({ ...base, ...period });
    expect(result?.validationErrors).toBeDefined();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("maps MAS_SAME_BILL from the RPC to its own message", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "MAS_SAME_BILL: a material and its own phase …" },
    });
    const result = await createBill(base);
    expect(result?.serverError).toMatch(/same bill/);
  });
});

describe("recordPayment — APX-60", () => {
  const payment = {
    billId: BILL_ID,
    paidOn: "2026-11-24",
    idempotencyKey: "00000000-0000-4000-8000-000000000098",
  };

  it("refuses a third decimal before reaching the database", async () => {
    const result = await recordPayment({ ...payment, amount: 99.995 });
    expect(result?.validationErrors).toBeDefined();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("accepts two decimals", async () => {
    h.rpc.mockResolvedValue({
      data: { id: BILL_ID, project_id: PROJECT_ID, status: "certified", bill_no: "RA-1", revision: 1 },
      error: null,
    });
    const result = await recordPayment({ ...payment, amount: 100.1 });
    expect(result?.data).toEqual({ id: BILL_ID, status: "certified" });
  });
});
