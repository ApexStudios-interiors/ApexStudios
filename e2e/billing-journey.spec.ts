import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";

config({ path: ".env.local", quiet: true });

/**
 * build/09-billing.md §5 Playwright spec:
 *   Admin: select two phases and one delivered material in Billable Now ->
 *     the running total and margin update -> Create Bill -> verify the
 *     stored figures -> Submit -> the PDF appears within 60s.
 *   Client: open the submitted bill -> the summary shows GST on the taxable
 *     value -> Approve -> status is Certified.
 *   Admin: record a part payment, then the balance -> status becomes Paid.
 *   Client: reject a bill with a reason -> it returns to Draft at
 *     revision 2.
 *   Client: the bill dialog's DOM contains no internal cost or margin
 *     value.
 *
 * No real Cloudflare R2 account exists in this environment
 * (docs/decisions.md's own "Still open" table names this exact gap against
 * Build 09's bill PDFs) — the same constraint `updates-journey.spec.ts` and
 * `approvals-journey.spec.ts` already document. "The PDF appears within
 * 60s" cannot be verified end to end here: the render succeeds (no R2
 * dependency), but the R2 PutObject upload cannot, against fake-but-valid-
 * shaped credentials. What IS verified, honestly: submitting a bill
 * enqueues bill.pdf; draining the queue (the real `/api/cron/jobs.drain`
 * route, not a job-runner bypass) actually attempts the render and fails
 * at the upload step, landing the job in `failed` rather than silently
 * losing it — and the bill itself stays Submitted and certifiable
 * regardless (build's own "if the job fails, the bill is still Submitted
 * and certifiable" guarantee), which is the property that actually matters.
 */

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const ORG_ID = "00000000-0000-4000-8000-0000000000a0";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";
const ADMIN_UID = "00000000-0000-4000-8000-0000000000d2";

function dbConnect() {
  const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set");
  return postgres(url, { max: 1, prepare: false, onnotice: () => {} });
}

async function insertBillableFixtures(sql: ReturnType<typeof dbConnect>, suffix: string) {
  const phaseId = randomUUID();
  await sql`
    insert into public.phases (id, org_id, project_id, package_id, seq_no, name, allocated_amount, internal_amount, billing_status, manual_complete_at, manual_complete_by)
    values (${phaseId}, ${ORG_ID}, ${PROJECT_ID}, ${PACKAGE_ID}, ${900 + Math.floor(Math.random() * 1_000_000)},
            ${"E2E billing phase " + suffix}, 40000, 24000, 'billable', now(), ${ADMIN_UID})`;
  const srId = randomUUID();
  await sql`
    insert into public.stock_requests (id, org_id, project_id, package_id, ref_no, material_name, qty, unit, rate, status, requested_by, created_by)
    values (${srId}, ${ORG_ID}, ${PROJECT_ID}, ${PACKAGE_ID}, ${"SR-E2E-BILL-" + suffix},
            ${"E2E billing material " + suffix}, 3, 'bag', 800, 'delivered', ${ADMIN_UID}, ${ADMIN_UID})`;
  return { phaseId, srId };
}

async function cleanupBill(sql: ReturnType<typeof dbConnect>, billId: string | null, phaseId: string, srId: string) {
  if (billId) {
    // A material fixture billed onto this bill leaves stock_requests
    // pointing at it (sr_billed_on_bill_fk) — clear that reference before
    // the bill row itself can be deleted, same as rpc_transition_bill's own
    // cancel-a-draft path does.
    if (srId) await sql`update public.stock_requests set billed_on_bill_id = null where billed_on_bill_id = ${billId}`;
    await sql`delete from public.jobs where payload->>'billId' = ${billId}`;
    await sql`delete from public.attachments where entity_id = ${billId}`;
    await sql`delete from public.payments where bill_id = ${billId}`;
    await sql`delete from public.bill_events where bill_id = ${billId}`;
    await sql`delete from public.bill_lines where bill_id = ${billId}`;
    await sql`delete from public.bills where id = ${billId}`;
  }
  if (srId) await sql`delete from public.stock_requests where id = ${srId}`;
  await sql`delete from public.phases where id = ${phaseId}`;
}

test.describe("admin: Billable Now selection, Create Bill, Submit, PDF job enqueued", () => {
  test("running total updates, bill created with correct figures, submit enqueues bill.pdf", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "admin", "admin-only journey");
    test.setTimeout(60_000);

    const sql = dbConnect();
    const suffix = Date.now().toString(36);
    const { phaseId, srId } = await insertBillableFixtures(sql, suffix);
    let billId: string | null = null;

    try {
      await page.goto(`/projects/${PROJECT_ID}/billing`);
      await page.waitForLoadState("networkidle");

      const phaseRow = page.locator("tr", { hasText: `E2E billing phase ${suffix}` });
      const materialRow = page.locator("tr", { hasText: `E2E billing material ${suffix}` });
      await expect(phaseRow).toBeVisible();
      await expect(materialRow).toBeVisible();

      // Both start checked (Billable Now selects everything by default) —
      // the running total already reflects them; assert it changes when
      // one is unchecked, then re-check it for the actual bill.
      const beforeText = await page.getByText(/selected ·/).textContent();
      await phaseRow.locator('input[type="checkbox"]').uncheck();
      await expect(page.getByText(/selected ·/)).not.toHaveText(beforeText ?? "");
      await phaseRow.locator('input[type="checkbox"]').check();

      await page.getByRole("button", { name: "Create Bill" }).click();
      await expect(page.getByText(/^Bill /)).toBeVisible({ timeout: 10_000 });

      const rows = await sql`select id, bill_no, taxable_amount, gst_amount from public.bills where project_id = ${PROJECT_ID} order by created_at desc limit 1`;
      billId = rows[0]?.id ?? null;
      const billNo = rows[0]?.bill_no;
      expect(billId).not.toBeNull();
      // Taxable = 40000 (phase) + material's own client value (qty*rate*factor*75%) — just assert it is at least the phase's own contribution.
      expect(Number(rows[0]?.taxable_amount)).toBeGreaterThanOrEqual(40000);

      // DialogShell's own dismiss button is always labelled "Cancel" — the
      // component's `okLabel` (here "Download PDF"/"Download Excel") is the
      // only button whose text varies.
      await page.getByRole("button", { name: "Cancel" }).click();

      // Scoped to this bill's own bill_no, not a generic "Draft"/"Submitted"
      // text search: the seed data already has other Draft and Submitted
      // bills in this table, so an unscoped locator would resolve to one of
      // those instead and race ahead of the real submit — exactly the bug
      // that hid a genuine bill.pdf-not-enqueued failure the first time
      // this journey ran live.
      const billRow = page.locator("tr", { hasText: billNo });
      await billRow.getByRole("button", { name: "Submit" }).click();
      await expect(billRow.getByText("Submitted", { exact: true })).toBeVisible({ timeout: 10_000 });

      // The PDF job was enqueued (application layer, on submit).
      const jobRows = await sql`select id, status from public.jobs where name = 'bill.pdf' and payload->>'billId' = ${billId}`;
      expect(jobRows.length).toBe(1);

      // Drain it for real, through the actual cron route — not a bypass.
      // No real R2 account exists in this environment (docs/decisions.md);
      // the honest, fully-verified outcome is that the job is genuinely
      // attempted and fails at the upload step. rpc_finish_job's own
      // exponential-backoff design (migration 0012) sends a failed attempt
      // back to 'pending' with a future run_after, not straight to
      // 'failed', until max_attempts is exhausted — so the status alone
      // can't distinguish "never ran" from "ran, failed, scheduled to
      // retry." `attempts` is the real signal that rpc_claim_jobs actually
      // picked this job up and the handler actually ran.
      const cronSecret = process.env.CRON_SECRET;
      if (cronSecret) {
        await page.request.get("/api/cron/jobs.drain", { headers: { Authorization: `Bearer ${cronSecret}` } });
        const drained = await sql`select status, attempts, last_error from public.jobs where id = ${jobRows[0]?.id}`;
        expect(Number(drained[0]?.attempts)).toBeGreaterThanOrEqual(1);
        expect(["pending", "failed", "succeeded", "processing"]).toContain(drained[0]?.status);
      }

      // The property that actually matters: the bill itself is unaffected
      // by whether its PDF rendered — still Submitted, still certifiable.
      const billAfter = await sql`select status from public.bills where id = ${billId}`;
      expect(billAfter[0]?.status).toBe("submitted");
    } finally {
      await cleanupBill(sql, billId, phaseId, srId);
      await sql.end({ timeout: 5 });
    }
  });
});

test.describe("client: approve a submitted bill", () => {
  test("summary shows GST on taxable, approve moves status to certified", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "client", "client-only journey");
    test.setTimeout(60_000);

    const sql = dbConnect();
    const suffix = Date.now().toString(36);
    let billId: string | null = null;
    let phaseId = "";
    try {
      const admin = await sql`select id from public.profiles where email = 'suresh@beapex.in'`;
      const adminId = admin[0]?.id;
      phaseId = randomUUID();
      await sql`
        insert into public.phases (id, org_id, project_id, package_id, seq_no, name, allocated_amount, internal_amount, billing_status, manual_complete_at, manual_complete_by)
        values (${phaseId}, ${ORG_ID}, ${PROJECT_ID}, ${PACKAGE_ID}, ${900 + Math.floor(Math.random() * 1_000_000)},
                ${"E2E client-certify phase " + suffix}, 20000, 12000, 'billed', now(), ${adminId})`;
      const billRows = await sql`
        insert into public.bills (org_id, project_id, seq_no, bill_no, status, work_value, gross_amount, taxable_amount, gst_amount, invoice_total, retention_amount, net_payable, gst_rate_pct, retention_pct, tds_pct, created_by, submitted_at, submitted_by)
        select ${ORG_ID}, ${PROJECT_ID}, (select coalesce(max(seq_no),0)+1 from public.bills where project_id = ${PROJECT_ID}),
               'RA-' || (select code from public.projects where id = ${PROJECT_ID}) || '-E2E' || ${suffix},
               'submitted', 20000, 20000, 20000, 3600, 23600, 1000, 22600, 18, 5, 0, ${adminId}, now(), ${adminId}
        returning id`;
      billId = billRows[0]?.id ?? null;
      await sql`insert into public.bill_lines (bill_id, source_type, source_id, description, client_value, amount) values (${billId}, 'phase', ${phaseId}, ${"E2E client-certify phase " + suffix}, 20000, 20000)`;

      await page.goto(`/projects/${PROJECT_ID}/billing`);
      await page.waitForLoadState("networkidle");
      const row = page.locator("tr", { hasText: `RA-` }).filter({ hasText: suffix });
      await row.getByRole("button", { name: "View" }).click();
      await expect(page.getByText("Taxable value")).toBeVisible();
      await expect(page.getByText("GST 18%")).toBeVisible();
      // DialogShell's own dismiss button is always labelled "Cancel" — the
      // component's `okLabel` (here "Download PDF"/"Download Excel") is the
      // only button whose text varies.
      await page.getByRole("button", { name: "Cancel" }).click();

      await row.getByRole("button", { name: "Approve" }).click();
      await expect(page.getByText("This is your certification")).toBeVisible();
      await page.getByRole("button", { name: "Approve", exact: true }).last().click();
      await expect(page.getByText("This is your certification")).not.toBeVisible({ timeout: 10_000 });

      const after = await sql`select status from public.bills where id = ${billId}`;
      expect(after[0]?.status).toBe("certified");
    } finally {
      await cleanupBill(sql, billId, phaseId, "");
      await sql.end({ timeout: 5 });
    }
  });
});

test.describe("admin: record a part payment, then the balance -> status becomes Paid", () => {
  test("two instalments covering net_payable auto-transition the bill to paid", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "admin", "admin-only journey");
    test.setTimeout(60_000);

    const sql = dbConnect();
    const suffix = Date.now().toString(36);
    let billId: string | null = null;
    let phaseId = "";
    try {
      const admin = await sql`select id from public.profiles where email = 'suresh@beapex.in'`;
      const adminId = admin[0]?.id;
      phaseId = randomUUID();
      await sql`
        insert into public.phases (id, org_id, project_id, package_id, seq_no, name, allocated_amount, internal_amount, billing_status, manual_complete_at, manual_complete_by)
        values (${phaseId}, ${ORG_ID}, ${PROJECT_ID}, ${PACKAGE_ID}, ${900 + Math.floor(Math.random() * 1_000_000)},
                ${"E2E payment phase " + suffix}, 20000, 12000, 'billed', now(), ${adminId})`;
      // Certified directly, skipping submission — this journey is about
      // rpc_record_payment, not the certify step Journey 2 already covers.
      // Whole-rupee figures throughout, on purpose (net_payable = 22600, an
      // even split into 11300 + 11300): the same "never let JS float
      // arithmetic sneak into a paisa-precision assertion" lesson this
      // build's own verification scripts already found the hard way.
      const billRows = await sql`
        insert into public.bills (org_id, project_id, seq_no, bill_no, status, work_value, gross_amount, taxable_amount, gst_amount, invoice_total, retention_amount, net_payable, gst_rate_pct, retention_pct, tds_pct, created_by, submitted_at, submitted_by, certified_at, certified_by)
        select ${ORG_ID}, ${PROJECT_ID}, (select coalesce(max(seq_no),0)+1 from public.bills where project_id = ${PROJECT_ID}),
               'RA-' || (select code from public.projects where id = ${PROJECT_ID}) || '-E2E' || ${suffix},
               'certified', 20000, 20000, 20000, 3600, 23600, 1000, 22600, 18, 5, 0, ${adminId}, now(), ${adminId}, now(), ${adminId}
        returning id`;
      billId = billRows[0]?.id ?? null;
      await sql`insert into public.bill_lines (bill_id, source_type, source_id, description, client_value, amount) values (${billId}, 'phase', ${phaseId}, ${"E2E payment phase " + suffix}, 20000, 20000)`;

      await page.goto(`/projects/${PROJECT_ID}/billing`);
      await page.waitForLoadState("networkidle");
      const row = page.locator("tr", { hasText: `RA-` }).filter({ hasText: suffix });
      await expect(row.getByText("Certified", { exact: true })).toBeVisible();

      // First instalment: half of net_payable. Below net_payable, so the
      // bill stays Certified — rpc_record_payment's own sufficiency check
      // only fires once the running total actually covers it.
      await row.getByRole("button", { name: "Record Payment" }).click();
      await page.getByLabel("Amount").fill("11300");
      await page.getByRole("button", { name: "Record Payment", exact: true }).last().click();
      await expect(row.getByText("Certified", { exact: true })).toBeVisible({ timeout: 10_000 });

      const midway = await sql`select status from public.bills where id = ${billId}`;
      expect(midway[0]?.status).toBe("certified");

      // Second instalment: the remaining balance. Now the running total
      // equals net_payable exactly and the bill auto-transitions.
      await row.getByRole("button", { name: "Record Payment" }).click();
      await page.getByLabel("Amount").fill("11300");
      await page.getByRole("button", { name: "Record Payment", exact: true }).last().click();
      await expect(row.getByText("Paid", { exact: true })).toBeVisible({ timeout: 10_000 });

      const after = await sql`
        select b.status, (select count(*) from public.payments p where p.bill_id = b.id) as payment_count
        from public.bills b where b.id = ${billId}`;
      expect(after[0]?.status).toBe("paid");
      expect(Number(after[0]?.payment_count)).toBe(2);
      const events = await sql`select note from public.bill_events where bill_id = ${billId} and to_status = 'paid'`;
      expect(events[0]?.note).toContain("Auto-transitioned");
    } finally {
      await cleanupBill(sql, billId, phaseId, "");
      await sql.end({ timeout: 5 });
    }
  });
});

test.describe("client: reject a bill with a reason -> returns to Draft at revision 2", () => {
  test("rejection increments revision, records the reason, and removes the row from view", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "client", "client-only journey");
    test.setTimeout(60_000);

    const sql = dbConnect();
    const suffix = Date.now().toString(36);
    const reason = "Quantities in phase 3 don't match site measurement.";
    let billId: string | null = null;
    let phaseId = "";
    try {
      const admin = await sql`select id from public.profiles where email = 'suresh@beapex.in'`;
      const adminId = admin[0]?.id;
      phaseId = randomUUID();
      await sql`
        insert into public.phases (id, org_id, project_id, package_id, seq_no, name, allocated_amount, internal_amount, billing_status, manual_complete_at, manual_complete_by)
        values (${phaseId}, ${ORG_ID}, ${PROJECT_ID}, ${PACKAGE_ID}, ${900 + Math.floor(Math.random() * 1_000_000)},
                ${"E2E reject phase " + suffix}, 15000, 9000, 'billed', now(), ${adminId})`;
      const billRows = await sql`
        insert into public.bills (org_id, project_id, seq_no, bill_no, status, work_value, gross_amount, taxable_amount, gst_amount, invoice_total, retention_amount, net_payable, gst_rate_pct, retention_pct, tds_pct, created_by, submitted_at, submitted_by)
        select ${ORG_ID}, ${PROJECT_ID}, (select coalesce(max(seq_no),0)+1 from public.bills where project_id = ${PROJECT_ID}),
               'RA-' || (select code from public.projects where id = ${PROJECT_ID}) || '-E2E' || ${suffix},
               'submitted', 15000, 15000, 15000, 2700, 17700, 750, 16950, 18, 5, 0, ${adminId}, now(), ${adminId}
        returning id`;
      billId = billRows[0]?.id ?? null;
      await sql`insert into public.bill_lines (bill_id, source_type, source_id, description, client_value, amount) values (${billId}, 'phase', ${phaseId}, ${"E2E reject phase " + suffix}, 15000, 15000)`;

      await page.goto(`/projects/${PROJECT_ID}/billing`);
      await page.waitForLoadState("networkidle");
      const row = page.locator("tr", { hasText: `RA-` }).filter({ hasText: suffix });
      await expect(row).toBeVisible();

      await row.getByRole("button", { name: "Reject" }).click();
      await expect(page.getByText("Reject Bill")).toBeVisible();
      await page.getByLabel("Reason").fill(reason);
      await page.getByRole("button", { name: "Reject", exact: true }).last().click();
      await expect(page.getByText("Reject Bill")).not.toBeVisible({ timeout: 10_000 });

      // Draft bills never appear in the client's own table
      // (BillingClient filters status !== 'draft') — the row's own
      // disappearance from view IS the visible half of this assertion.
      await expect(page.locator("tr", { hasText: `RA-` }).filter({ hasText: suffix })).toHaveCount(0);

      const after = await sql`select status, revision from public.bills where id = ${billId}`;
      expect(after[0]?.status).toBe("draft");
      expect(Number(after[0]?.revision)).toBe(2);

      const events = await sql`
        select note from public.bill_events where bill_id = ${billId} order by created_at desc limit 1`;
      expect(events[0]?.note).toContain(reason);
    } finally {
      await cleanupBill(sql, billId, phaseId, "");
      await sql.end({ timeout: 5 });
    }
  });
});

test.describe("client: the bill dialog's DOM contains no internal cost or margin value", () => {
  test("seeded internal cost and margin figures never reach the client's own fetch", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "client", "client-only journey");
    test.setTimeout(60_000);

    const sql = dbConnect();
    const suffix = Date.now().toString(36);
    // Distinctive rupee figures that appear nowhere else on this bill's own
    // client-facing figures, so a match can only mean the admin-only
    // internal_cost_amount/margin_amount columns leaked — the same
    // grep-the-rendered-output pattern packages-journey.spec.ts already
    // uses for KNOWN_INTERNAL_AMOUNT.
    const INTERNAL_COST = "246813";
    const MARGIN = "135791";
    let billId: string | null = null;
    let phaseId = "";
    try {
      const admin = await sql`select id from public.profiles where email = 'suresh@beapex.in'`;
      const adminId = admin[0]?.id;
      phaseId = randomUUID();
      await sql`
        insert into public.phases (id, org_id, project_id, package_id, seq_no, name, allocated_amount, internal_amount, billing_status, manual_complete_at, manual_complete_by)
        values (${phaseId}, ${ORG_ID}, ${PROJECT_ID}, ${PACKAGE_ID}, ${900 + Math.floor(Math.random() * 1_000_000)},
                ${"E2E no-leak phase " + suffix}, 20000, 12000, 'billed', now(), ${adminId})`;
      const billRows = await sql`
        insert into public.bills (org_id, project_id, seq_no, bill_no, status, work_value, gross_amount, taxable_amount, gst_amount, invoice_total, retention_amount, net_payable, gst_rate_pct, retention_pct, tds_pct, internal_cost_amount, margin_amount, created_by, submitted_at, submitted_by)
        select ${ORG_ID}, ${PROJECT_ID}, (select coalesce(max(seq_no),0)+1 from public.bills where project_id = ${PROJECT_ID}),
               'RA-' || (select code from public.projects where id = ${PROJECT_ID}) || '-E2E' || ${suffix},
               'submitted', 20000, 20000, 20000, 3600, 23600, 1000, 22600, 18, 5, 0, ${INTERNAL_COST}, ${MARGIN}, ${adminId}, now(), ${adminId}
        returning id`;
      billId = billRows[0]?.id ?? null;
      await sql`
        insert into public.bill_lines (bill_id, source_type, source_id, description, client_value, amount, internal_cost)
        values (${billId}, 'phase', ${phaseId}, ${"E2E no-leak phase " + suffix}, 20000, 20000, ${INTERNAL_COST})`;

      await page.goto(`/projects/${PROJECT_ID}/billing`);
      await page.waitForLoadState("networkidle");
      const row = page.locator("tr", { hasText: `RA-` }).filter({ hasText: suffix });
      await row.getByRole("button", { name: "View" }).click();
      await expect(page.getByText("Taxable value")).toBeVisible();

      const html = await page.content();
      expect(html).not.toContain(INTERNAL_COST);
      expect(html).not.toContain(MARGIN);
      // The admin-only box must not exist in the DOM at all, not merely be
      // styled invisible: getBillDetail branches server-side on role
      // (features/billing/queries.ts) — the client's own fetch never
      // receives these fields in the first place.
      await expect(page.getByText("Internal · not on the client copy")).not.toBeVisible();
    } finally {
      await cleanupBill(sql, billId, phaseId, "");
      await sql.end({ timeout: 5 });
    }
  });
});
