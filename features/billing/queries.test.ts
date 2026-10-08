import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * getBillDetail — the shared bill read behind the web bill dialog and the
 * mobile bill detail — with the RLS-scoped client faked, recording every
 * filter. What it pins down: a soft-deleted bill is gone for an admin too
 * (`deleted_at is null` on `bills`, as every other admin bill read), and a
 * client still reads only `v_bill_client` (which hides deleted bills in
 * SQL); a bill not returned means null, with nothing else read.
 */

type Result = { data: unknown; error: { message: string } | null };

const h = vi.hoisted(() => ({
  calls: [] as unknown[][],
  bill: { data: null, error: null } as Result,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/r2/presign", () => ({ presignGet: vi.fn(async (key: string) => `https://r2/${key}`) }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      h.calls.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => (h.calls.push(["select", table, ...a]), chain),
        eq: (...a: unknown[]) => (h.calls.push(["eq", table, ...a]), chain),
        is: (...a: unknown[]) => (h.calls.push(["is", table, ...a]), chain),
        order: () => chain,
        maybeSingle: async () => h.bill,
        then: (resolve: (v: Result) => unknown) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));

const { getBillDetail } = await import("./queries");

const BILL_ID = "00000000-0000-4000-8000-0000000000e1";
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

const ROW = {
  id: BILL_ID,
  project_id: PROJECT_ID,
  bill_no: "RA-APX-001",
  bill_date: "2026-10-01",
  period_from: null,
  period_to: null,
  status: "submitted",
  revision: 1,
  work_value: 100,
  material_value: 0,
  gross_amount: 100,
  mas_recovery_amount: 0,
  taxable_amount: 100,
  gst_amount: 18,
  invoice_total: 118,
  retention_amount: 5,
  tds_amount: 0,
  advance_recovery: 0,
  net_payable: 113,
  gst_rate_pct: 18,
  retention_pct: 5,
  tds_pct: 0,
  notes: null,
  submitted_at: null,
  certified_at: null,
  certification_note: null,
  paid_at: null,
  created_at: "2026-10-01T00:00:00Z",
  internal_cost_amount: 80,
  margin_amount: 20,
};

function filtersOn(table: string) {
  return h.calls
    .filter((c) => (c[0] === "eq" || c[0] === "is") && c[1] === table)
    .map((c) => c.slice(0, 1).concat(c.slice(2)));
}

beforeEach(() => {
  h.calls.length = 0;
  h.bill = { data: ROW, error: null };
});

describe("getBillDetail — soft-deleted bills", () => {
  it("admin: reads `bills` by id AND deleted_at is null — a deleted bill is never matched", async () => {
    await getBillDetail(sessionAs("admin"), BILL_ID);

    expect(filtersOn("bills")).toEqual([
      ["eq", "id", BILL_ID],
      ["is", "deleted_at", null],
    ]);
  });

  it("admin: a visible bill is still returned, with its internal figures", async () => {
    const detail = await getBillDetail(sessionAs("admin"), BILL_ID);

    expect(detail?.bill).toMatchObject({
      id: BILL_ID,
      refNo: "RA-APX-001",
      internalCostAmount: 80,
      marginAmount: 20,
    });
  });

  it("admin: a deleted bill (no row under the filter) is null, and nothing else is read", async () => {
    h.bill = { data: null, error: null };

    const detail = await getBillDetail(sessionAs("admin"), BILL_ID);

    expect(detail).toBeNull();
    expect(h.calls.filter((c) => c[0] === "from").map((c) => c[1])).toEqual(["bills"]);
  });

  it("client: still reads only v_bill_client (which hides deleted bills in SQL), never `bills`", async () => {
    const detail = await getBillDetail(sessionAs("client"), BILL_ID);

    expect(h.calls.filter((c) => c[0] === "from").map((c) => c[1])).not.toContain("bills");
    expect(filtersOn("v_bill_client")).toEqual([["eq", "id", BILL_ID]]);
    expect(detail?.bill).not.toHaveProperty("internalCostAmount");
  });

  it("client: a bill the view does not return is null", async () => {
    h.bill = { data: null, error: null };

    expect(await getBillDetail(sessionAs("client"), BILL_ID)).toBeNull();
  });
});
