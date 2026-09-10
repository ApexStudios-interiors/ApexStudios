import { afterAll, describe, expect, it } from "vitest";
import { connect, SEED } from "./db";
import { one } from "./expect-row";

/**
 * The constraints that make invalid states unrepresentable. Each of these is
 * cheaper than the test that would otherwise have to catch the bug in
 * application code, which is the whole argument for putting them in the schema.
 */
const sql = connect();
afterAll(() => sql.end({ timeout: 5 }));

describe("schema constraints", () => {
  it("rejects negative stock outright, with no override", async () => {
    await expect(
      sql`update public.inventory_items set qty_on_hand = -1 where id = ${SEED.cementItem}`
    ).rejects.toThrow(/inventory_qty_ck/);
  });

  it("idx_bill_lines_source rejects a second line for the same source", async () => {
    // The double-billing guard. Billing the same completed phase twice must fail
    // at the database, not at a code path someone might forget to write.
    await expect(
      sql`insert into public.bill_lines (bill_id, source_type, source_id, description, client_value, pct_billed, amount)
          values (${SEED.billPaid}, 'phase', ${SEED.phaseWaterproofing}, 'duplicate phase line', 1, 100, 1)`
    ).rejects.toThrow(/idx_bill_lines_source|duplicate key/i);
  });

  it("allows many manual lines, because they carry no source", async () => {
    const a = one(
      await sql`insert into public.bill_lines (bill_id, source_type, source_id, description, client_value, pct_billed, amount)
                values (${SEED.billPaid}, 'manual', null, 'manual one', 1, 100, 1) returning id`,
      "first manual line"
    );
    const b = one(
      await sql`insert into public.bill_lines (bill_id, source_type, source_id, description, client_value, pct_billed, amount)
                values (${SEED.billPaid}, 'manual', null, 'manual two', 1, 100, 1) returning id`,
      "second manual line"
    );
    expect(a.id).not.toBe(b.id);
    await sql`delete from public.bill_lines where id in (${a.id}, ${b.id})`;
  });

  it("makes 'decided but no timestamp' unrepresentable on approvals", async () => {
    await expect(
      sql`update public.approvals set status = 'approved'
           where ref_no = 'AP-BHEL-NCH-004'`
    ).rejects.toThrow(/ap_decided_ck/);
  });

  it("requires a reason on a rejected stock request", async () => {
    await expect(
      sql`update public.stock_requests set status = 'rejected', rejected_reason = null
           where ref_no = 'SR-BHEL-NCH-014'`
    ).rejects.toThrow(/sr_reject_ck/);
  });

  it("accepts a task whose denormalised ancestry is correct", async () => {
    const t = one(
      await sql`insert into public.tasks (org_id, project_id, package_id, phase_id, name, start_date)
                values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage},
                        ${SEED.phaseTiling}, 'correct ancestry', current_date)
                returning id`,
      "inserted task"
    );
    await sql`delete from public.tasks where id = ${t.id}`;
  });

  it("rejects a task whose denormalised ancestry is wrong", async () => {
    // project_id and package_id on tasks exist so RLS reads an indexed local
    // column instead of a two-join lateral. If they can drift away from
    // phase_id's real ancestry, that shortcut becomes a lie.
    await expect(
      sql`insert into public.tasks (org_id, project_id, package_id, phase_id, name, start_date)
          values (${SEED.org}, ${SEED.project},
                  '00000000-0000-4000-8000-0000000000e2', ${SEED.phaseTiling},
                  'wrong package', current_date)`
    ).rejects.toThrow(/INVARIANT/);
  });

  it("computes tasks.end_date rather than trusting the caller", async () => {
    const t = one(
      await sql`insert into public.tasks (org_id, project_id, package_id, phase_id, name, start_date, duration_weeks)
                values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, ${SEED.phaseTiling},
                        'generated column check', date '2026-01-05', 3)
                returning id, end_date`,
      "inserted task"
    );
    // postgres.js parses `date` as a JS Date at UTC midnight; String(Date)
    // renders it in the local zone ("...GMT+0530...") rather than as
    // YYYY-MM-DD, so compare via toISOString() instead of a substring check
    // against the platform-dependent Date.toString() format.
    // 5 Jan + (3 * 7) - 1 = 25 Jan
    expect((t.end_date as Date).toISOString().slice(0, 10)).toBe("2026-01-25");
    await sql`delete from public.tasks where id = ${t.id}`;
  });
});
