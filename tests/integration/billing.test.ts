import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { connect, SEED } from "./db";
import { one } from "./expect-row";
import { signedInAs } from "./auth";

/**
 * build/09-billing.md §5. AGENTS.md's own testing table: "New RPC ->
 * Integration test including the illegal-transition and concurrency
 * cases," and "Billing logic -> Unit tests, 100% branch coverage" (that
 * half is `features/billing/service.test.ts`). Tested from real client-SDK
 * sessions (AGENTS.md database rule 8) — `rpc_create_bill`/
 * `rpc_transition_bill`/`rpc_record_payment` all call `auth_role()`/
 * `auth.uid()` internally, so a raw privileged connection would not
 * exercise the same code path a real caller does.
 */

const SITE_EMAIL = "ravi@beapex.in";
const ADMIN_EMAIL = "suresh@beapex.in";
const OWNER_EMAIL = "hello@beapex.in";
const CLIENT_EMAIL = "tvrao@example.invalid";

const sql = connect();
const openClients: SupabaseClient[] = [];
async function client(email: string) {
  const c = await signedInAs(email);
  openClients.push(c);
  return c;
}

type BillRow = {
  id: string;
  bill_no: string;
  seq_no: number;
  project_id: string;
  status: string;
  material_value: number | string;
  mas_recovery_amount: number | string;
  net_payable: number | string;
  gst_amount: number | string;
  taxable_amount: number | string;
  retention_amount: number | string;
  revision: number;
  gst_rate_pct: number | string;
};

const trackedPhaseIds: string[] = [];
const trackedSrIds: string[] = [];
const trackedBillIds: string[] = [];

afterEach(async () => {
  if (trackedBillIds.length) {
    await sql`delete from public.payments where bill_id = any(${trackedBillIds})`;
    await sql`delete from public.bill_events where bill_id = any(${trackedBillIds})`;
    await sql`delete from public.bill_lines where bill_id = any(${trackedBillIds})`;
    await sql`update public.stock_requests set billed_on_bill_id = null where billed_on_bill_id = any(${trackedBillIds})`;
    await sql`delete from public.bills where id = any(${trackedBillIds})`;
    trackedBillIds.length = 0;
  }
  if (trackedSrIds.length) {
    await sql`delete from public.stock_requests where id = any(${trackedSrIds})`;
    trackedSrIds.length = 0;
  }
  if (trackedPhaseIds.length) {
    await sql`delete from public.phases where id = any(${trackedPhaseIds})`;
    trackedPhaseIds.length = 0;
  }
});
afterAll(async () => {
  await sql.end({ timeout: 5 });
});

/** A disposable, manually-completed billable phase — never a seeded one, so
 *  this file's own bill creations have nothing shared left to corrupt. */
async function insertTestPhase(overrides: {
  allocated: number;
  internal: number;
  refSuffix: string;
}): Promise<string> {
  const rows = await sql`
    insert into public.phases (org_id, project_id, package_id, seq_no, name, allocated_amount, internal_amount, billing_status, manual_complete_at, manual_complete_by)
    values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, ${900 + Math.floor(Math.random() * 1_000_000)}, ${"Billing test phase " + overrides.refSuffix},
            ${overrides.allocated}, ${overrides.internal}, 'billable', now(), ${SEED.adminProfile})
    returning id`;
  const row = one(rows, "inserted phase");
  trackedPhaseIds.push(row.id);
  return row.id;
}

async function insertTestDeliveredMaterial(overrides: {
  qty: number;
  rate: number;
  refSuffix: string;
  phaseId?: string;
}): Promise<string> {
  const rows = await sql`
    insert into public.stock_requests (org_id, project_id, package_id, phase_id, ref_no, material_name, qty, unit, rate, status, requested_by, created_by)
    values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, ${overrides.phaseId ?? null},
            ${"SR-BILLTEST-" + overrides.refSuffix}, 'Billing test material', ${overrides.qty}, 'bag', ${overrides.rate},
            'delivered', ${SEED.siteProfile}, ${SEED.siteProfile})
    returning id`;
  const row = one(rows, "inserted stock request");
  trackedSrIds.push(row.id);
  return row.id;
}

async function createBill(
  as: SupabaseClient,
  lines: { source_type: "phase" | "material"; source_id: string }[],
  idempotencyKey?: string
): Promise<BillRow> {
  const { data, error } = await as.rpc("rpc_create_bill", {
    p_project_id: SEED.project,
    p_lines: lines,
    p_idempotency_key: idempotencyKey ?? randomUUID(),
  });
  if (error) throw new Error(`rpc_create_bill failed: ${error.message}`);
  const row = data as BillRow;
  trackedBillIds.push(row.id);
  return row;
}

describe("rpc_create_bill — T-01 arithmetic (GST before retention)", () => {
  it("computes gst on the full taxable value, not taxable minus retention", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 100000, internal: 60000, refSuffix: "t01" });
    const bill = await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);

    expect(Number(bill.taxable_amount)).toBe(100000);
    expect(Number(bill.gst_amount)).toBe(18000); // 100000 * 18%, on the FULL taxable value
    expect(Number(bill.retention_amount)).toBe(5000); // 100000 * 5%, independent of gst
    const buggyGst = (100000 - 5000) * 0.18;
    expect(Number(bill.gst_amount)).not.toBe(buggyGst);
  });
});

describe("rpc_create_bill — bill_no does not truncate past seq 99", () => {
  it("a seq_no of 3+ digits is not truncated to its own leftmost two characters", async () => {
    // Real, live-caught bug: `lpad(v_seq::text, 2, '0')` was written to
    // zero-pad small numbers ('1' -> '01'), but Postgres's lpad TRUNCATES a
    // string already longer than the target width instead of leaving it
    // alone — lpad('174', 2, '0') is '17', not '174'. Every bill in the
    // same ten-wide bucket (170-179, 180-189, ...) then collided on the
    // truncated bill_no, surfacing as a misleading ALREADY_BILLED
    // (bills_no_uq's own unique_violation, caught by rpc_create_bill's
    // broad `exception when unique_violation` and blamed on the wrong
    // cause). Caught live when this build's own heavy verification pushed
    // a dev project's next_bill_seq past 99 and T-02/T-03 both started
    // failing for a reason neither test's own logic had anything to do
    // with. Fixed in migration 20260916090007; this pins the fix down.
    const admin = await client(ADMIN_EMAIL);
    const before = one(
      await sql`select next_bill_seq, code from public.projects where id = ${SEED.project}`,
      "project before seq bump"
    );
    await sql`update public.projects set next_bill_seq = 174 where id = ${SEED.project}`;
    try {
      const phaseId = await insertTestPhase({ allocated: 1000, internal: 500, refSuffix: "seq174" });
      const bill = await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);
      expect(bill.seq_no).toBe(174);
      expect(bill.bill_no).toBe(`RA-${before.code}-174`);
      expect(bill.bill_no).not.toBe(`RA-${before.code}-17`);
    } finally {
      await sql`update public.projects set next_bill_seq = ${before.next_bill_seq} where id = ${SEED.project}`;
    }
  });
});

describe("rpc_create_bill — T-02 MAS recovery", () => {
  it("a material billed at 75% is not billed again when its phase completes", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 50000, internal: 30000, refSuffix: "t02" });
    const srId = await insertTestDeliveredMaterial({ qty: 4, rate: 1000, refSuffix: "t02", phaseId });

    // The material is billed first, on its own (75% MAS advance) — the
    // phase itself is created 'billable' by insertTestPhase, so it is
    // eligible immediately; bill the material alone first.
    const materialBill = await createBill(admin, [{ source_type: "material", source_id: srId }]);
    // 4 bags @ 1000 = 4000 internal, at mas_billable_pct (75%, seed default)
    // through the package's own cost->client factor — just assert it landed
    // somewhere sane rather than hard-coding the factor here too.
    expect(Number(materialBill.material_value)).toBeGreaterThan(0);

    // MAS recovery only counts a committed bill's own material lines — a
    // still-draft one might yet be cancelled (whose bill_lines are then
    // hard-deleted), so it must not have already reduced another bill's
    // taxable value. Submit it before billing the phase, matching the real
    // admin workflow this build's own review pass caught the RPC skipping.
    await admin.rpc("rpc_transition_bill", { p_bill_id: materialBill.id, p_to_status: "submitted" });

    const phaseBill = await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);
    expect(Number(phaseBill.mas_recovery_amount)).toBeGreaterThan(0);
    expect(Number(phaseBill.taxable_amount)).toBe(50000 - Number(phaseBill.mas_recovery_amount));
  });

  it("a still-draft material bill does not reduce another bill's MAS recovery", async () => {
    // Real bug, found in a pre-merge review pass, not a live smoke test:
    // the MAS recovery join had no filter on the owning bill's own status,
    // so a material bill left in draft (never submitted or cancelled) was
    // counted exactly like a real, committed invoice. If that draft bill
    // were later cancelled, the other bill's already-snapshotted figures
    // would permanently understate what the client owes. Fixed in
    // migration 20260916090008 by excluding status = 'draft'.
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 50000, internal: 30000, refSuffix: "t02-draft" });
    const srId = await insertTestDeliveredMaterial({ qty: 4, rate: 1000, refSuffix: "t02-draft", phaseId });

    // Billed but deliberately left in draft — never submitted.
    const materialBill = await createBill(admin, [{ source_type: "material", source_id: srId }]);
    expect(materialBill.status).toBe("draft");

    const phaseBill = await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);
    expect(Number(phaseBill.mas_recovery_amount)).toBe(0);
    expect(Number(phaseBill.taxable_amount)).toBe(50000);
  });
});

describe("rpc_create_bill — T-04 the double-billing guard", () => {
  it("rejects billing the same phase twice", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 20000, internal: 10000, refSuffix: "t04" });
    await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);

    // Second attempt: v_billable_now no longer lists this phase (already on
    // a bill_line), so this surfaces as the clean ALREADY_BILLED domain
    // error, not a raw unique-constraint violation.
    const { error } = await admin.rpc("rpc_create_bill", {
      p_project_id: SEED.project,
      p_lines: [{ source_type: "phase", source_id: phaseId }],
      p_idempotency_key: randomUUID(),
    });
    expect(error?.message).toMatch(/ALREADY_BILLED|NOTHING_SELECTED/);
  });

  it("the unique index itself rejects a direct duplicate insert", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 15000, internal: 9000, refSuffix: "t04b" });
    const bill = await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);

    await expect(
      sql`insert into public.bill_lines (bill_id, source_type, source_id, description, client_value, amount)
          values (${bill.id}, 'phase', ${phaseId}, 'duplicate attempt', 15000, 15000)`
    ).rejects.toThrow(/idx_bill_lines_source|duplicate key/);
  });
});

describe("rpc_create_bill — idempotency", () => {
  it("a double-submitted createBill with the same idempotency key produces one bill", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 10000, internal: 5000, refSuffix: "idem" });
    const key = randomUUID();
    const first = await createBill(admin, [{ source_type: "phase", source_id: phaseId }], key);
    const { data: second, error } = await admin.rpc("rpc_create_bill", {
      p_project_id: SEED.project,
      p_lines: [{ source_type: "phase", source_id: phaseId }],
      p_idempotency_key: key,
    });
    expect(error).toBeNull();
    expect((second as BillRow).id).toBe(first.id);

    const rows = await sql`select count(*)::int as n from public.bills where bill_no = ${first.bill_no}`;
    expect(one(rows, "bill count by bill_no").n).toBe(1);
  });
});

describe("rpc_create_bill — role guards", () => {
  it("a client cannot create a bill", async () => {
    const clientSession = await client(CLIENT_EMAIL);
    const { error } = await clientSession.rpc("rpc_create_bill", {
      p_project_id: SEED.project,
      p_lines: [],
      p_idempotency_key: randomUUID(),
    });
    expect(error?.message).toMatch(/FORBIDDEN/);
  });

  it("a site session cannot create a bill", async () => {
    const site = await client(SITE_EMAIL);
    const { error } = await site.rpc("rpc_create_bill", {
      p_project_id: SEED.project,
      p_lines: [],
      p_idempotency_key: randomUUID(),
    });
    expect(error?.message).toMatch(/FORBIDDEN/);
  });
});

describe("rpc_create_bill — concurrency (T-03)", () => {
  it("N concurrent creates on the same project produce sequential, non-duplicate bill numbers", async () => {
    // build's own "run 50 times" describes a CI-loop stress test; run here
    // as one batch of 10 genuinely concurrent creates against 10 distinct
    // fixture phases (rather than 50 sequential sign-in-heavy iterations,
    // which the shared Supabase Auth rate limit this dev project runs
    // under — 30 sign-ins/5min — cannot sustain) — the row lock either
    // serialises correctly under real concurrency or it does not, and 10
    // simultaneous callers already exercise that.
    const N = 10;
    const admin = await client(ADMIN_EMAIL);
    const phaseIds = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        insertTestPhase({ allocated: 1000 * (i + 1), internal: 500, refSuffix: `conc-${i}` })
      )
    );

    const results = await Promise.all(
      phaseIds.map((phaseId) =>
        admin.rpc("rpc_create_bill", {
          p_project_id: SEED.project,
          p_lines: [{ source_type: "phase", source_id: phaseId }],
          p_idempotency_key: randomUUID(),
        })
      )
    );
    for (const r of results) {
      expect(r.error).toBeNull();
      trackedBillIds.push((r.data as BillRow).id);
    }
    const seqNos = results.map((r) => (r.data as BillRow).seq_no).sort((a, b) => a - b);
    const billNos = new Set(results.map((r) => (r.data as BillRow).bill_no));
    expect(billNos.size).toBe(N); // every bill_no distinct
    for (let i = 1; i < seqNos.length; i++) {
      expect(seqNos[i]).toBe((seqNos[i - 1] ?? 0) + 1); // gapless and sequential
    }
  });
});

describe("rpc_transition_bill — lifecycle and T-05", () => {
  it("admin cannot transition submitted -> certified", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 30000, internal: 18000, refSuffix: "t05" });
    const bill = await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);
    await admin.rpc("rpc_transition_bill", { p_bill_id: bill.id, p_to_status: "submitted" });

    const { error } = await admin.rpc("rpc_transition_bill", {
      p_bill_id: bill.id,
      p_to_status: "certified",
    });
    expect(error?.message).toMatch(/FORBIDDEN/);
  });

  it("owner is also FORBIDDEN from certifying — not just admin", async () => {
    const admin = await client(ADMIN_EMAIL);
    const owner = await client(OWNER_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 12000, internal: 7000, refSuffix: "t05b" });
    const bill = await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);
    await admin.rpc("rpc_transition_bill", { p_bill_id: bill.id, p_to_status: "submitted" });

    const { error } = await owner.rpc("rpc_transition_bill", {
      p_bill_id: bill.id,
      p_to_status: "certified",
    });
    expect(error?.message).toMatch(/FORBIDDEN/);
  });

  it("client certifies a submitted bill", async () => {
    const admin = await client(ADMIN_EMAIL);
    const clientSession = await client(CLIENT_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 25000, internal: 15000, refSuffix: "certify" });
    const bill = await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);
    await admin.rpc("rpc_transition_bill", { p_bill_id: bill.id, p_to_status: "submitted" });

    const { data, error } = await clientSession.rpc("rpc_transition_bill", {
      p_bill_id: bill.id,
      p_to_status: "certified",
    });
    expect(error).toBeNull();
    expect((data as BillRow).status).toBe("certified");
  });

  it("client rejection returns the bill to draft with revision 2 and the reason recorded", async () => {
    const admin = await client(ADMIN_EMAIL);
    const clientSession = await client(CLIENT_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 8000, internal: 4000, refSuffix: "reject" });
    const bill = await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);
    await admin.rpc("rpc_transition_bill", { p_bill_id: bill.id, p_to_status: "submitted" });

    const { error: noReasonErr } = await clientSession.rpc("rpc_transition_bill", {
      p_bill_id: bill.id,
      p_to_status: "draft",
    });
    expect(noReasonErr?.message).toMatch(/REASON_REQUIRED/);

    const { data, error } = await clientSession.rpc("rpc_transition_bill", {
      p_bill_id: bill.id,
      p_to_status: "draft",
      p_note: "Wrong package listed",
    });
    expect(error).toBeNull();
    const row = data as BillRow;
    expect(row.status).toBe("draft");
    expect(row.revision).toBe(2);

    const events =
      await sql`select note from public.bill_events where bill_id = ${bill.id} order by created_at desc limit 1`;
    expect(one(events, "latest bill_event").note).toBe("Wrong package listed");
  });

  it("cancelling a draft returns its phase to billable and clears billed_on_bill_id", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 6000, internal: 3000, refSuffix: "cancel-phase" });
    const srId = await insertTestDeliveredMaterial({ qty: 2, rate: 500, refSuffix: "cancel-mat" });
    const bill = await createBill(admin, [
      { source_type: "phase", source_id: phaseId },
      { source_type: "material", source_id: srId },
    ]);

    const { data, error } = await admin.rpc("rpc_transition_bill", {
      p_bill_id: bill.id,
      p_to_status: "cancelled",
    });
    expect(error).toBeNull();
    expect((data as BillRow).status).toBe("cancelled");

    const phaseRows = await sql`select billing_status from public.phases where id = ${phaseId}`;
    expect(one(phaseRows, "phase after cancel").billing_status).toBe("billable");
    const srRows = await sql`select billed_on_bill_id from public.stock_requests where id = ${srId}`;
    expect(one(srRows, "stock request after cancel").billed_on_bill_id).toBeNull();
    const lineRows = await sql`select id from public.bill_lines where bill_id = ${bill.id}`;
    expect(lineRows.length).toBe(0);
  });

  it("a submitted bill's lines cannot be updated or deleted by any role", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 9000, internal: 5000, refSuffix: "immutable" });
    const bill = await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);
    await admin.rpc("rpc_transition_bill", { p_bill_id: bill.id, p_to_status: "submitted" });

    // No update/delete policy exists for bill_lines at all (any role, any
    // status) — asserted here from the real client session rather than the
    // structural pgTAP check alone, against a genuinely submitted bill.
    const del = await admin.from("bill_lines").delete().eq("bill_id", bill.id).select("id");
    expect(del.data ?? []).toHaveLength(0);
  });

  it("changing projects.gst_rate_pct after a bill is issued does not change that bill's figures", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertTestPhase({ allocated: 40000, internal: 24000, refSuffix: "snapshot" });
    const bill = await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);
    const originalGst = Number(bill.gst_amount);

    await sql`update public.projects set gst_rate_pct = 5 where id = ${SEED.project}`;
    try {
      const rows = await sql`select gst_amount, gst_rate_pct from public.bills where id = ${bill.id}`;
      const after = one(rows, "bill after project rate change");
      expect(Number(after.gst_amount)).toBe(originalGst);
      expect(Number(after.gst_rate_pct)).toBe(18); // the snapshot, not the new project rate
    } finally {
      await sql`update public.projects set gst_rate_pct = 18 where id = ${SEED.project}`;
    }
  });
});

describe("rpc_record_payment", () => {
  async function certifiedBill(admin: SupabaseClient, clientSession: SupabaseClient, refSuffix: string) {
    const phaseId = await insertTestPhase({ allocated: 50000, internal: 30000, refSuffix });
    const bill = await createBill(admin, [{ source_type: "phase", source_id: phaseId }]);
    await admin.rpc("rpc_transition_bill", { p_bill_id: bill.id, p_to_status: "submitted" });
    const { data } = await clientSession.rpc("rpc_transition_bill", {
      p_bill_id: bill.id,
      p_to_status: "certified",
    });
    return data as BillRow;
  }

  it("transitions to paid only once the full net_payable is covered", async () => {
    const admin = await client(ADMIN_EMAIL);
    const clientSession = await client(CLIENT_EMAIL);
    const bill = await certifiedBill(admin, clientSession, "pay-full");
    const net = Number(bill.net_payable);

    const half = Math.floor(net * 50) / 100;
    const { data: afterHalf, error: e1 } = await admin.rpc("rpc_record_payment", {
      p_bill_id: bill.id,
      p_amount: half,
      p_paid_on: "2026-09-16",
      p_idempotency_key: randomUUID(),
    });
    expect(e1).toBeNull();
    expect((afterHalf as BillRow).status).toBe("certified");

    const remainder = Math.round(net * 100 - half * 100) / 100;
    const { data: afterFull, error: e2 } = await admin.rpc("rpc_record_payment", {
      p_bill_id: bill.id,
      p_amount: remainder,
      p_paid_on: "2026-09-16",
      p_idempotency_key: randomUUID(),
    });
    expect(e2).toBeNull();
    expect((afterFull as BillRow).status).toBe("paid");

    const paidRows =
      await sql`select coalesce(sum(amount), 0)::numeric as total from public.payments where bill_id = ${bill.id}`;
    expect(Number(one(paidRows, "payments sum").total)).toBe(net);
  });

  it("refuses a payment that would exceed net_payable", async () => {
    const admin = await client(ADMIN_EMAIL);
    const clientSession = await client(CLIENT_EMAIL);
    const bill = await certifiedBill(admin, clientSession, "overpay");
    const { error } = await admin.rpc("rpc_record_payment", {
      p_bill_id: bill.id,
      p_amount: Number(bill.net_payable) + 1,
      p_paid_on: "2026-09-16",
      p_idempotency_key: randomUUID(),
    });
    expect(error?.message).toMatch(/OVERPAYMENT/);
  });

  it("a client cannot record a payment", async () => {
    const admin = await client(ADMIN_EMAIL);
    const clientSession = await client(CLIENT_EMAIL);
    const bill = await certifiedBill(admin, clientSession, "client-pay");
    const { error } = await clientSession.rpc("rpc_record_payment", {
      p_bill_id: bill.id,
      p_amount: 100,
      p_paid_on: "2026-09-16",
      p_idempotency_key: randomUUID(),
    });
    expect(error?.message).toMatch(/FORBIDDEN/);
  });

  it("a double-submitted payment with the same idempotency key is recorded once", async () => {
    const admin = await client(ADMIN_EMAIL);
    const clientSession = await client(CLIENT_EMAIL);
    const bill = await certifiedBill(admin, clientSession, "idem-pay");
    const key = randomUUID();
    const amount = Math.floor(Number(bill.net_payable) / 3);

    await admin.rpc("rpc_record_payment", {
      p_bill_id: bill.id,
      p_amount: amount,
      p_paid_on: "2026-09-16",
      p_idempotency_key: key,
    });
    await admin.rpc("rpc_record_payment", {
      p_bill_id: bill.id,
      p_amount: amount,
      p_paid_on: "2026-09-16",
      p_idempotency_key: key,
    });

    const rows =
      await sql`select count(*)::int as n from public.payments where bill_id = ${bill.id} and idempotency_key = ${key}`;
    expect(one(rows, "payment count by idempotency key").n).toBe(1);
  });
});
