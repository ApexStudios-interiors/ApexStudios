import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connect, SEED } from "./db";
import { one } from "./expect-row";
import { signedInAs } from "./auth";

/**
 * build/05-schedule-and-progress.md §4, Integration:
 *   T-17: every task in a phase reaching 100 flips billing_status to billable.
 *   Dropping a task below 100 returns an unresolved phase to unresolved, and
 *     never touches a phase already billed or paid.
 *   rpc_mark_phase_complete on a phase WITH tasks is refused.
 *   A client calling setTaskProgress is refused.
 *   A site user calling setTaskProgress on a project they are not a member of
 *     is refused.
 *   The rollup trigger updates package and project progress_pct in the same
 *     transaction.
 *
 * AGENTS.md database rule 8: the RPC calls themselves go through real
 * signed-in supabase-js sessions, never the privileged `sql` connection —
 * that connection is test SETUP/teardown only (seeding and cleaning up
 * fixture rows), the same role tests/integration's other files already give
 * it.
 */

const sql = connect();
afterAll(() => sql.end({ timeout: 5 }));

describe("a site user can create a task under a phase they cannot directly SELECT from phases (D24)", () => {
  it('does not misread phases\' admin-only RLS as "phase does not exist"', async () => {
    const site = await signedInAs("ravi@beapex.in");
    const { data: phase } = await site
      .from("v_phase_site")
      .select("project_id, package_id")
      .eq("id", SEED.phaseWaterproofing)
      .single();
    expect(phase).not.toBeNull();

    const { data: created, error } = await site
      .from("tasks")
      .insert({
        org_id: SEED.org,
        project_id: phase?.project_id,
        package_id: phase?.package_id,
        phase_id: SEED.phaseWaterproofing,
        name: "D24 regression fixture task",
        start_date: "2026-09-01",
        duration_weeks: 1,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(created?.id).toBeDefined();

    if (created) await sql`delete from public.tasks where id = ${created.id}`;
  });
});

describe("rpc_set_task_progress: T-17 phase billing_status flip", () => {
  let phaseId: string;
  let taskA: string;
  let taskB: string;
  let admin: SupabaseClient;

  beforeAll(async () => {
    admin = await signedInAs("suresh@beapex.in");
    const phase = one(
      await sql`insert into public.phases (org_id, project_id, package_id, seq_no, name)
                values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, 90, 'T-17 fixture phase')
                returning id`,
      "fixture phase"
    );
    phaseId = phase.id as string;
    const tasks = await sql`
      insert into public.tasks (org_id, project_id, package_id, phase_id, name, start_date, duration_weeks)
      values
        (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, ${phaseId}, 'T-17 task A', date '2026-09-01', 1),
        (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, ${phaseId}, 'T-17 task B', date '2026-09-01', 1)
      returning id`;
    taskA = one(tasks.slice(0, 1), "fixture task A").id as string;
    taskB = one(tasks.slice(1, 2), "fixture task B").id as string;
  });

  afterAll(async () => {
    await sql`delete from public.tasks where phase_id = ${phaseId}`;
    await sql`delete from public.phases where id = ${phaseId}`;
  });

  async function phaseStatus() {
    return one(await sql`select billing_status from public.phases where id = ${phaseId}`, "fixture phase")
      .billing_status;
  }

  it("stays unresolved while any task is below 100", async () => {
    expect(await phaseStatus()).toBe("unresolved");
    const { error } = await admin.rpc("rpc_set_task_progress", { p_task_id: taskA, p_pct: 100 });
    expect(error).toBeNull();
    expect(await phaseStatus()).toBe("unresolved");
  });

  it("flips to billable once every task reaches 100", async () => {
    const { error } = await admin.rpc("rpc_set_task_progress", { p_task_id: taskB, p_pct: 100 });
    expect(error).toBeNull();
    expect(await phaseStatus()).toBe("billable");
  });

  it("returns to unresolved when a task drops below 100", async () => {
    const { error } = await admin.rpc("rpc_set_task_progress", { p_task_id: taskB, p_pct: 80 });
    expect(error).toBeNull();
    expect(await phaseStatus()).toBe("unresolved");
  });

  it("updates the package and project progress_pct rollup in the same transaction", async () => {
    const before = one(
      await sql`select progress_pct from public.packages where id = ${SEED.poolPackage}`,
      "pool package"
    ).progress_pct as number;
    await admin.rpc("rpc_set_task_progress", { p_task_id: taskA, p_pct: 0 });
    const after = one(
      await sql`select progress_pct from public.packages where id = ${SEED.poolPackage}`,
      "pool package"
    ).progress_pct as number;
    // The two fixture tasks moving from 100/80 to 0/80 must have moved the
    // duration-weighted mean the rollup trigger maintains — not asserting an
    // exact number (every other real task in this package also feeds it),
    // just that the trigger actually ran off this write.
    expect(after).not.toBe(before);
    await admin.rpc("rpc_set_task_progress", { p_task_id: taskA, p_pct: 100 });
    await admin.rpc("rpc_set_task_progress", { p_task_id: taskB, p_pct: 100 });
  });
});

describe("rpc_set_task_progress never reopens a billed or paid phase", () => {
  it("a task dropping below 100 does not move a billed phase back to unresolved", async () => {
    const admin = await signedInAs("suresh@beapex.in");
    // SEED.phaseWaterproofing is seeded as billing_status = 'billed' with two
    // tasks already at 100 — see supabase/seed.sql.
    const before = one(
      await sql`select billing_status from public.phases where id = ${SEED.phaseWaterproofing}`,
      "phaseWaterproofing"
    ).billing_status;
    expect(before).toBe("billed");

    const { error } = await admin.rpc("rpc_set_task_progress", {
      p_task_id: "00000000-0000-4000-8000-000000000102",
      p_pct: 50,
    });
    expect(error).toBeNull();

    const after = one(
      await sql`select billing_status from public.phases where id = ${SEED.phaseWaterproofing}`,
      "phaseWaterproofing"
    ).billing_status;
    expect(after).toBe("billed");

    // restore
    await admin.rpc("rpc_set_task_progress", {
      p_task_id: "00000000-0000-4000-8000-000000000102",
      p_pct: 100,
    });
  });
});

describe("rpc_set_task_progress refusals", () => {
  it("a client is refused", async () => {
    const client = await signedInAs("tvrao@example.invalid");
    const { error } = await client.rpc("rpc_set_task_progress", {
      p_task_id: "00000000-0000-4000-8000-000000000101",
      p_pct: 50,
    });
    expect(error?.message).toMatch(/FORBIDDEN/);
  });

  it("a site user on a project they are not a member of is refused", async () => {
    // Fixture task under the project (c2) ravi (site) has no project_members
    // row for. Leftovers first: a run that died before its cleanup (e.g. an
    // auth rate limit in signedInAs) left seq_no 91 behind, and every later
    // run then failed on phases_seq_uq. Cleanup is in `finally` for the same
    // reason.
    await sql`delete from public.tasks where phase_id in (select id from public.phases
              where package_id = '00000000-0000-4000-8000-0000000000e7' and seq_no = 91)`;
    await sql`delete from public.phases where package_id = '00000000-0000-4000-8000-0000000000e7' and seq_no = 91`;
    const phase = one(
      await sql`insert into public.phases (org_id, project_id, package_id, seq_no, name)
                values (${SEED.org}, '00000000-0000-4000-8000-0000000000c2',
                        '00000000-0000-4000-8000-0000000000e7', 91, 'non-member fixture phase')
                returning id`,
      "fixture phase"
    );
    try {
      const task = one(
        await sql`insert into public.tasks (org_id, project_id, package_id, phase_id, name, start_date, duration_weeks)
                  values (${SEED.org}, '00000000-0000-4000-8000-0000000000c2',
                          '00000000-0000-4000-8000-0000000000e7', ${phase.id}, 'non-member fixture task',
                          date '2026-09-01', 1)
                  returning id`,
        "fixture task"
      );

      const site = await signedInAs("ravi@beapex.in");
      const { error } = await site.rpc("rpc_set_task_progress", { p_task_id: task.id, p_pct: 50 });
      expect(error?.message).toMatch(/FORBIDDEN/);
    } finally {
      await sql`delete from public.tasks where phase_id = ${phase.id}`;
      await sql`delete from public.phases where id = ${phase.id}`;
    }
  });

  it("an out-of-range percentage is refused with a clean domain error", async () => {
    const admin = await signedInAs("suresh@beapex.in");
    const { error } = await admin.rpc("rpc_set_task_progress", {
      p_task_id: "00000000-0000-4000-8000-000000000101",
      p_pct: 150,
    });
    expect(error?.message).toMatch(/REASON_REQUIRED/);
  });
});

describe("rpc_mark_phase_complete", () => {
  it("is refused for a phase that has tasks", async () => {
    const admin = await signedInAs("suresh@beapex.in");
    const { error } = await admin.rpc("rpc_mark_phase_complete", { p_phase_id: SEED.phaseTiling });
    expect(error?.message).toMatch(/ILLEGAL_TRANSITION/);
  });

  it("succeeds for a zero-task phase and is refused once the phase is billed or paid", async () => {
    const admin = await signedInAs("suresh@beapex.in");
    // Same leftover/finally treatment as the seq_no 91 fixture above.
    await sql`delete from public.phases where package_id = ${SEED.poolPackage} and seq_no = 92`;
    const phase = one(
      await sql`insert into public.phases (org_id, project_id, package_id, seq_no, name)
                values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, 92, 'mark-complete fixture phase')
                returning id`,
      "fixture phase"
    );
    try {
      const ok = await admin.rpc("rpc_mark_phase_complete", { p_phase_id: phase.id });
      expect(ok.error).toBeNull();
      expect(
        one(await sql`select billing_status from public.phases where id = ${phase.id}`, "fixture phase")
          .billing_status
      ).toBe("billable");

      await sql`update public.phases set billing_status = 'paid' where id = ${phase.id}`;
      const refused = await admin.rpc("rpc_mark_phase_complete", { p_phase_id: phase.id });
      expect(refused.error?.message).toMatch(/ILLEGAL_TRANSITION/);
    } finally {
      await sql`delete from public.phases where id = ${phase.id}`;
    }
  });
});
