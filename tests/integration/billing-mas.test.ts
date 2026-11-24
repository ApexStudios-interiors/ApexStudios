import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { connect, SEED, withLedgerMaintenance } from "./db";
import { one } from "./expect-row";
import { previewBill, type BillableLine } from "@/features/billing/service";

/**
 * Material-at-site double billing (APX-07) and the rest of migration
 * 20261124200001 / 20261124200002 / 20261124200003 (D69), from real client-SDK
 * sessions (AGENTS.md database rule 8). One test per ordering the audit
 * named, plus the preview-equals-bill check (APX-30), recovery above gross
 * (APX-31), ₹0 material (APX-14), the IST bill date (APX-22), duplicate
 * selections and payment rounding (APX-60), and the concurrency case.
 */

const PASSWORD = "apex-dev-only";
const ADMIN_EMAIL = "suresh@beapex.in";
const CLIENT_EMAIL = "tvrao@example.invalid";

function anonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.");
  return createClient(url, key);
}

const sql = connect();
const openClients: SupabaseClient[] = [];
async function client(email: string) {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  openClients.push(c);
  return c;
}

type BillRow = {
  id: string;
  bill_no: string;
  status: string;
  bill_date: string;
  period_from: string | null;
  period_to: string | null;
  work_value: number | string;
  material_value: number | string;
  gross_amount: number | string;
  mas_recovery_amount: number | string;
  taxable_amount: number | string;
  gst_amount: number | string;
  invoice_total: number | string;
  retention_amount: number | string;
  tds_amount: number | string;
  advance_recovery: number | string;
  net_payable: number | string;
  internal_cost_amount: number | string;
  margin_amount: number | string;
};

const trackedPhaseIds: string[] = [];
const trackedSrIds: string[] = [];
const trackedBillIds: string[] = [];

afterEach(async () => {
  // Ledgers are append-only (20261124100008); cleanup runs with the
  // transaction-local maintenance switch on.
  await withLedgerMaintenance(sql, async (tx) => {
    if (trackedBillIds.length) {
      await tx`delete from public.payments where bill_id = any(${trackedBillIds})`;
      await tx`delete from public.bill_events where bill_id = any(${trackedBillIds})`;
      await tx`delete from public.bill_lines where bill_id = any(${trackedBillIds})`;
      await tx`update public.stock_requests set billed_on_bill_id = null where billed_on_bill_id = any(${trackedBillIds})`;
      await tx`delete from public.jobs where payload->>'billId' = any(${trackedBillIds})`;
      await tx`delete from public.bills where id = any(${trackedBillIds})`;
      trackedBillIds.length = 0;
    }
    if (trackedSrIds.length) {
      await tx`delete from public.stock_requests where id = any(${trackedSrIds})`;
      trackedSrIds.length = 0;
    }
    if (trackedPhaseIds.length) {
      await tx`delete from public.phases where id = any(${trackedPhaseIds})`;
      trackedPhaseIds.length = 0;
    }
  });
});
afterAll(async () => {
  await Promise.all(openClients.map((c) => c.auth.signOut()));
  await sql.end({ timeout: 5 });
});

/** A disposable, manually-completed billable phase. internal = allocated by
 *  default, so its cost->client factor is 1 and material figures are easy to
 *  state exactly. */
async function insertPhase(allocated: number, internal = allocated): Promise<string> {
  const rows = await sql`
    insert into public.phases (org_id, project_id, package_id, seq_no, name, allocated_amount, internal_amount, billing_status, manual_complete_at, manual_complete_by)
    values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, ${900 + Math.floor(Math.random() * 1_000_000)},
            ${"MAS test phase " + randomUUID().slice(0, 8)}, ${allocated}, ${internal}, 'billable', now(), ${SEED.adminProfile})
    returning id`;
  const row = one(rows, "inserted phase");
  trackedPhaseIds.push(row.id);
  return row.id;
}

async function insertMaterial(o: {
  qty: number;
  rate: number | null;
  phaseId: string | null;
}): Promise<string> {
  const rows = await sql`
    insert into public.stock_requests (org_id, project_id, package_id, phase_id, ref_no, material_name, qty, unit, rate, status, requested_by, created_by)
    values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, ${o.phaseId},
            ${"SR-MASTEST-" + randomUUID().slice(0, 8)}, 'MAS test material', ${o.qty}, 'bag', ${o.rate},
            'delivered', ${SEED.siteProfile}, ${SEED.siteProfile})
    returning id`;
  const row = one(rows, "inserted stock request");
  trackedSrIds.push(row.id);
  return row.id;
}

type Line = { source_type: "phase" | "material"; source_id: string };
const ph = (id: string): Line => ({ source_type: "phase", source_id: id });
const mat = (id: string): Line => ({ source_type: "material", source_id: id });

async function tryCreate(as: SupabaseClient, lines: Line[], extra: Record<string, unknown> = {}) {
  const res = await as.rpc("rpc_create_bill", {
    p_project_id: SEED.project,
    p_lines: lines,
    p_idempotency_key: randomUUID(),
    ...extra,
  });
  if (res.data) trackedBillIds.push((res.data as BillRow).id);
  return res as { data: BillRow | null; error: { message: string } | null };
}

async function create(as: SupabaseClient, lines: Line[], extra: Record<string, unknown> = {}) {
  const { data, error } = await tryCreate(as, lines, extra);
  if (error || !data) throw new Error(`rpc_create_bill failed: ${error?.message}`);
  return data;
}

async function submit(as: SupabaseClient, billId: string) {
  const { error } = await as.rpc("rpc_transition_bill", { p_bill_id: billId, p_to_status: "submitted" });
  if (error) throw new Error(`submit failed: ${error.message}`);
}

async function billableIds(): Promise<Set<string>> {
  const rows = await sql`select source_id from public.v_billable_now where project_id = ${SEED.project}`;
  return new Set(rows.map((r) => r.source_id as string));
}

async function materialAmount(srId: string): Promise<number> {
  const rows =
    await sql`select amount from public.bill_lines where source_type = 'material' and source_id = ${srId}`;
  return Number(one(rows, "material bill line").amount);
}

describe("APX-07 ordering 1 — material and its phase on the same bill", () => {
  it("is refused with MAS_SAME_BILL; the phase alone bills its value once, and the material then leaves Billable Now", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertPhase(1000000);
    const srId = await insertMaterial({ qty: 400, rate: 1000, phaseId }); // ₹4,00,000 client value

    const both = await tryCreate(admin, [ph(phaseId), mat(srId)]);
    expect(both.error?.message).toMatch(/MAS_SAME_BILL/);
    expect(both.data).toBeNull();

    const bill = await create(admin, [ph(phaseId)]);
    expect(Number(bill.taxable_amount)).toBe(1000000); // not 13,00,000
    expect(Number(bill.gst_amount)).toBe(180000); // not 2,34,000

    expect((await billableIds()).has(srId)).toBe(false); // R1
  });
});

describe("APX-07 ordering 2 — material on a draft, then its phase, then the draft submitted", () => {
  it("refuses the phase while the material is on a draft (MAS_DRAFT_PENDING, naming the draft)", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertPhase(50000);
    const srId = await insertMaterial({ qty: 4, rate: 1000, phaseId });
    const materialBill = await create(admin, [mat(srId)]);
    expect(materialBill.status).toBe("draft");

    const v = await sql`select blocked_by_bill_no from public.v_billable_now where source_id = ${phaseId}`;
    expect(one(v, "phase row").blocked_by_bill_no).toBe(materialBill.bill_no);

    const phaseBill = await tryCreate(admin, [ph(phaseId)]);
    expect(phaseBill.error?.message).toMatch(/MAS_DRAFT_PENDING/);
    expect(phaseBill.error?.message).toContain(materialBill.bill_no);
  });

  it("once the material's draft is submitted, the phase bill recovers it", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertPhase(50000);
    const srId = await insertMaterial({ qty: 4, rate: 1000, phaseId });
    const materialBill = await create(admin, [mat(srId)]);
    await submit(admin, materialBill.id);

    const phaseBill = await create(admin, [ph(phaseId)]);
    const advance = await materialAmount(srId);
    expect(advance).toBe(3000); // 4 × 1000 × factor 1 × 75%
    expect(Number(phaseBill.mas_recovery_amount)).toBe(advance);
    expect(Number(phaseBill.taxable_amount)).toBe(50000 - advance);
    // Across both bills the client is charged the phase's value exactly once.
    expect(Number(materialBill.taxable_amount) + Number(phaseBill.taxable_amount)).toBe(50000);
  });

  it("if the draft is cancelled instead, the phase bills in full and the material does not come back", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertPhase(50000);
    const srId = await insertMaterial({ qty: 4, rate: 1000, phaseId });
    const materialBill = await create(admin, [mat(srId)]);
    const { error } = await admin.rpc("rpc_transition_bill", {
      p_bill_id: materialBill.id,
      p_to_status: "cancelled",
    });
    expect(error).toBeNull();
    expect((await billableIds()).has(srId)).toBe(true); // returned to Billable Now

    const phaseBill = await create(admin, [ph(phaseId)]);
    expect(Number(phaseBill.mas_recovery_amount)).toBe(0);
    expect(Number(phaseBill.taxable_amount)).toBe(50000);
    expect((await billableIds()).has(srId)).toBe(false); // covered by the phase now
  });
});

describe("APX-07 ordering 3 — phase billed, material delivered later", () => {
  it("the later material never appears in Billable Now and cannot be billed", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertPhase(20000);
    await create(admin, [ph(phaseId)]);

    const srId = await insertMaterial({ qty: 2, rate: 1000, phaseId });
    expect((await billableIds()).has(srId)).toBe(false);
    const res = await tryCreate(admin, [mat(srId)]);
    expect(res.error?.message).toMatch(/NOTHING_SELECTED|ALREADY_BILLED/);
  });

  it("…including while the phase's bill is still a draft, and it returns if that draft is cancelled", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertPhase(20000);
    const phaseBill = await create(admin, [ph(phaseId)]);
    const srId = await insertMaterial({ qty: 2, rate: 1000, phaseId });
    expect((await billableIds()).has(srId)).toBe(false);

    await admin.rpc("rpc_transition_bill", { p_bill_id: phaseBill.id, p_to_status: "cancelled" });
    expect((await billableIds()).has(srId)).toBe(true);
  });
});

describe("APX-07 ordering 4 — package-level material (no phase)", () => {
  it("is not billed as an advance at all (R4, CA review)", async () => {
    const admin = await client(ADMIN_EMAIL);
    const srId = await insertMaterial({ qty: 5, rate: 800, phaseId: null });
    expect((await billableIds()).has(srId)).toBe(false);
    const res = await tryCreate(admin, [mat(srId)]);
    expect(res.error?.message).toMatch(/NOTHING_SELECTED|ALREADY_BILLED/);
  });
});

describe("APX-14 — a material with no rate is not billable", () => {
  it.each([null, 0])("rate %s: not in Billable Now", async (rate) => {
    const phaseId = await insertPhase(10000);
    const srId = await insertMaterial({ qty: 5, rate, phaseId });
    expect((await billableIds()).has(srId)).toBe(false);
  });
});

describe("APX-31 — recovery above gross is refused, not floored", () => {
  it("MAS_EXCEEDS_GROSS when the phase alone is worth less than its material advance; adding lines resolves it", async () => {
    const admin = await client(ADMIN_EMAIL);
    const smallPhase = await insertPhase(1000);
    const srId = await insertMaterial({ qty: 10, rate: 1000, phaseId: smallPhase }); // advance 7500
    const materialBill = await create(admin, [mat(srId)]);
    await submit(admin, materialBill.id);

    const alone = await tryCreate(admin, [ph(smallPhase)]);
    expect(alone.error?.message).toMatch(/MAS_EXCEEDS_GROSS/);

    const otherPhase = await insertPhase(20000);
    const bill = await create(admin, [ph(smallPhase), ph(otherPhase)]);
    expect(Number(bill.gross_amount)).toBe(21000);
    expect(Number(bill.mas_recovery_amount)).toBe(7500);
    expect(Number(bill.taxable_amount)).toBe(Number(bill.gross_amount) - Number(bill.mas_recovery_amount));
  });
});

describe("APX-30 — the preview is the bill", () => {
  it("previewBill over v_billable_now's own columns equals what rpc_create_bill stores", async () => {
    const admin = await client(ADMIN_EMAIL);
    // A phase with a committed material advance to recover, a second phase,
    // and an unrelated material: every step of HLD §8.4 has something in it.
    const p1 = await insertPhase(50000, 30000);
    const m1 = await insertMaterial({ qty: 3, rate: 1000, phaseId: p1 });
    const advanceBill = await create(admin, [mat(m1)]);
    await submit(admin, advanceBill.id);
    const p2 = await insertPhase(33333.33, 20000);
    const p3 = await insertPhase(70000, 50000);
    const m2 = await insertMaterial({ qty: 7, rate: 123.45, phaseId: p3 });

    const selection = [ph(p1), ph(p2), mat(m2)];
    const viewRows = await sql`
      select source_type, amount, internal_cost, mas_recovery from public.v_billable_now
       where project_id = ${SEED.project} and source_id = any(${[p1, p2, m2]})`;
    expect(viewRows).toHaveLength(3);
    const project = one(
      await sql`select gst_rate_pct, retention_pct, tds_pct, mobilisation_advance, mobilisation_recovered, mobilisation_recovery_pct
                  from public.projects where id = ${SEED.project}`,
      "project rates"
    );
    const lines: BillableLine[] = viewRows.map((r) => ({
      sourceType: r.source_type as "phase" | "material",
      amount: String(r.amount),
      internalCost: String(r.internal_cost),
      masRecovery: String(r.mas_recovery),
    }));
    const preview = previewBill(lines, {
      gstRatePct: String(project.gst_rate_pct),
      retentionPct: String(project.retention_pct),
      tdsPct: String(project.tds_pct),
      mobilisationAdvance: String(project.mobilisation_advance),
      mobilisationRecovered: String(project.mobilisation_recovered),
      mobilisationRecoveryPct: String(project.mobilisation_recovery_pct),
    });

    const bill = await create(admin, selection);
    const eq = (stored: number | string, previewed: Decimal) =>
      expect(new Decimal(String(stored)).toFixed(2)).toBe(previewed.toFixed(2));
    eq(bill.work_value, preview.workValue);
    eq(bill.material_value, preview.materialValue);
    eq(bill.gross_amount, preview.grossAmount);
    eq(bill.mas_recovery_amount, preview.masRecoveryAmount);
    eq(bill.taxable_amount, preview.taxableAmount);
    eq(bill.gst_amount, preview.gstAmount);
    eq(bill.invoice_total, preview.invoiceTotal);
    eq(bill.retention_amount, preview.retentionAmount);
    eq(bill.tds_amount, preview.tdsAmount);
    eq(bill.advance_recovery, preview.advanceRecovery);
    eq(bill.net_payable, preview.netPayable);
    eq(bill.internal_cost_amount, preview.internalCostAmount);
    eq(bill.margin_amount, preview.marginAmount);
    expect(Number(bill.mas_recovery_amount)).toBeGreaterThan(0);
  });
});

describe("APX-60 — material line rounding and duplicate selections", () => {
  it("a material line's amount is its stored client value × pct, to the paisa", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertPhase(100000, 70000); // factor 1.428571…
    const srId = await insertMaterial({ qty: 3, rate: 333.33, phaseId });
    await create(admin, [mat(srId)]);
    const line = one(
      await sql`select client_value, pct_billed, amount from public.bill_lines where source_type = 'material' and source_id = ${srId}`,
      "material line"
    );
    const expected = new Decimal(String(line.client_value))
      .times(String(line.pct_billed))
      .dividedBy(100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    expect(new Decimal(String(line.amount)).toFixed(2)).toBe(expected.toFixed(2));
  });

  it("the same item selected twice is billed once, not refused as ALREADY_BILLED", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertPhase(12000);
    const bill = await create(admin, [ph(phaseId), ph(phaseId)]);
    expect(Number(bill.work_value)).toBe(12000);
    const lines = await sql`select id from public.bill_lines where bill_id = ${bill.id}`;
    expect(lines).toHaveLength(1);
  });
});

describe("APX-22 — bill date and billing period", () => {
  it("defaults to today in Asia/Kolkata, and stores an optional period", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertPhase(9000);
    const bill = await create(admin, [ph(phaseId)], {
      p_period_from: "2026-10-01",
      p_period_to: "2026-10-31",
    });
    const today = one(await sql`select (now() at time zone 'Asia/Kolkata')::date::text as d`, "today").d;
    expect(bill.bill_date).toBe(today);
    expect(bill.period_from).toBe("2026-10-01");
    expect(bill.period_to).toBe("2026-10-31");
  });

  it.each([
    [{ p_period_from: "2026-10-01" }, "only a start"],
    [{ p_period_from: "2026-10-31", p_period_to: "2026-10-01" }, "start after end"],
  ])("refuses %j (%s) with INVALID_PERIOD", async (period: Record<string, string>, _why: string) => {
    void _why;
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertPhase(9000);
    const res = await tryCreate(admin, [ph(phaseId)], period);
    expect(res.error?.message).toMatch(/INVALID_PERIOD/);
  });

  it("first submission re-dates the bill to today (IST); a resubmission after rejection keeps that date", async () => {
    const admin = await client(ADMIN_EMAIL);
    const clientSession = await client(CLIENT_EMAIL);
    const phaseId = await insertPhase(9000);
    const bill = await create(admin, [ph(phaseId)], { p_bill_date: "2026-01-15" });
    expect(bill.bill_date).toBe("2026-01-15");

    await submit(admin, bill.id);
    const today = one(await sql`select (now() at time zone 'Asia/Kolkata')::date::text as d`, "today").d;
    const afterSubmit = one(
      await sql`select bill_date::text as d from public.bills where id = ${bill.id}`,
      "bill"
    );
    expect(afterSubmit.d).toBe(today);

    // Pin a recognisable first-submission date, then reject and resubmit.
    await sql`update public.bills set bill_date = '2026-02-01' where id = ${bill.id}`;
    const { error: rejectErr } = await clientSession.rpc("rpc_transition_bill", {
      p_bill_id: bill.id,
      p_to_status: "draft",
      p_note: "Recheck quantities",
    });
    expect(rejectErr).toBeNull();
    await submit(admin, bill.id);
    const afterResubmit = one(
      await sql`select bill_date::text as d from public.bills where id = ${bill.id}`,
      "bill"
    );
    expect(afterResubmit.d).toBe("2026-02-01");
  });
});

describe("APX-60 — a payment is rounded to the paisa before it is compared", () => {
  it("a payment that rounds to the full net payable marks the bill paid", async () => {
    const admin = await client(ADMIN_EMAIL);
    const clientSession = await client(CLIENT_EMAIL);
    const phaseId = await insertPhase(10000);
    const bill = await create(admin, [ph(phaseId)]);
    await submit(admin, bill.id);
    await clientSession.rpc("rpc_transition_bill", { p_bill_id: bill.id, p_to_status: "certified" });

    const nearly = new Decimal(String(bill.net_payable)).minus("0.005").toNumber(); // e.g. 11299.995
    const { data, error } = await admin.rpc("rpc_record_payment", {
      p_bill_id: bill.id,
      p_amount: nearly,
      p_paid_on: "2026-11-24",
      p_idempotency_key: randomUUID(),
    });
    expect(error).toBeNull();
    expect((data as BillRow).status).toBe("paid");
    const paid = one(
      await sql`select amount::text as a from public.payments where bill_id = ${bill.id}`,
      "payment"
    );
    expect(paid.a).toBe(new Decimal(String(bill.net_payable)).toFixed(2));
  });

  it("an amount that rounds to 0.00 is refused", async () => {
    const admin = await client(ADMIN_EMAIL);
    const clientSession = await client(CLIENT_EMAIL);
    const phaseId = await insertPhase(10000);
    const bill = await create(admin, [ph(phaseId)]);
    await submit(admin, bill.id);
    await clientSession.rpc("rpc_transition_bill", { p_bill_id: bill.id, p_to_status: "certified" });
    const { error } = await admin.rpc("rpc_record_payment", {
      p_bill_id: bill.id,
      p_amount: 0.004,
      p_paid_on: "2026-11-24",
      p_idempotency_key: randomUUID(),
    });
    expect(error?.message).toMatch(/REASON_REQUIRED/);
  });
});

describe("concurrency — a material and its phase billed at the same moment", () => {
  it("never both succeed: the project row lock serialises them and the second is refused", async () => {
    const admin = await client(ADMIN_EMAIL);
    const phaseId = await insertPhase(40000);
    const srId = await insertMaterial({ qty: 4, rate: 1000, phaseId });

    const [a, b] = await Promise.all([tryCreate(admin, [mat(srId)]), tryCreate(admin, [ph(phaseId)])]);
    const succeeded = [a, b].filter((r) => r.error === null);
    expect(succeeded).toHaveLength(1);
    const failure = [a, b].find((r) => r.error !== null);
    expect(failure?.error?.message).toMatch(/MAS_DRAFT_PENDING|ALREADY_BILLED|NOTHING_SELECTED/);
  });
});
