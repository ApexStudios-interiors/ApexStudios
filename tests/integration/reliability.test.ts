import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { connect, SEED } from "./db";
import { one } from "./expect-row";

const PASSWORD = "apex-dev-only";
const ADMIN_EMAIL = "suresh@beapex.in";
const SITE_EMAIL = "ravi@beapex.in";
const CLIENT_EMAIL = "tvrao@example.invalid";

const openClients: SupabaseClient[] = [];
/** A real signed-in session (AGENTS.md database rule 8: RLS is tested from a client SDK). */
async function signedInAs(email: string): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  const supabase = createClient(url, key);
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  openClients.push(supabase);
  return supabase;
}
afterAll(async () => {
  await Promise.all(openClients.map((c) => c.auth.signOut()));
});

/**
 * Migrations 20261124600001–20261124600006 against a real database:
 * APX-23 (jobs go terminal), APX-21 (project progress follows packages),
 * APX-43 (manual completion yields to tasks), APX-45/66 (seq_no allocation,
 * updated_at that ignores the progress cache, RESTRICT on evidence), APX-06
 * (the sweep's key check) and APX-52 (SQL money totals).
 *
 * Every fixture is its own project, never a seeded one, and is removed in
 * afterAll — children first, because evidence foreign keys are RESTRICT now.
 */
const sql = connect();

const projectIds: string[] = [];
afterAll(async () => {
  for (const id of projectIds) {
    await sql`delete from public.attachments where project_id = ${id}`;
    await sql`delete from public.approvals where project_id = ${id}`;
    await sql`delete from public.tasks where project_id = ${id}`;
    await sql`delete from public.phases where project_id = ${id}`;
    await sql`delete from public.packages where project_id = ${id}`;
    await sql`delete from public.projects where id = ${id}`;
  }
  await sql`delete from public.jobs where name like 'test.rel.%'`;
  await sql.end({ timeout: 5 });
});

async function fixtureProject(code: string): Promise<string> {
  const p = one(
    await sql`insert into public.projects (org_id, client_id, code, name, start_date)
              values (${SEED.org}, (select client_id from public.projects where id = ${SEED.project}),
                      ${code + "-" + Math.floor(Math.random() * 1e6)}, ${"Reliability fixture " + code}, current_date)
              returning id`,
    "fixture project"
  );
  projectIds.push(p.id);
  return p.id;
}

/** seq_no omitted on purpose: the trigger allocates it. */
async function addPackage(projectId: string, allocated: number): Promise<string> {
  return one(
    await sql`insert into public.packages (org_id, project_id, name, allocated_amount)
              values (${SEED.org}, ${projectId}, 'Fixture package', ${allocated})
              returning id`,
    "fixture package"
  ).id;
}

async function addPhase(projectId: string, packageId: string): Promise<string> {
  return one(
    await sql`insert into public.phases (org_id, project_id, package_id, name)
              values (${SEED.org}, ${projectId}, ${packageId}, 'Fixture phase')
              returning id`,
    "fixture phase"
  ).id;
}

async function addTask(projectId: string, packageId: string, phaseId: string, pct: number): Promise<string> {
  return one(
    await sql`insert into public.tasks (org_id, project_id, package_id, phase_id, name, start_date, duration_weeks, progress_pct)
              values (${SEED.org}, ${projectId}, ${packageId}, ${phaseId}, 'Fixture task', current_date, 1, ${pct})
              returning id`,
    "fixture task"
  ).id;
}

async function projectProgress(projectId: string): Promise<number> {
  return Number(
    one(await sql`select progress_pct from public.projects where id = ${projectId}`, "project").progress_pct
  );
}

// ── APX-23 ───────────────────────────────────────────────────────────────────
describe("jobs go terminal (APX-23)", () => {
  afterEach(async () => {
    await sql`delete from public.jobs where name like 'test.rel.%'`;
  });

  it("the reaper fails a job that has used its attempts, and backs off one that has not", async () => {
    const spent = one(
      await sql`insert into public.jobs (name, status, attempts, max_attempts, lease_until, started_at)
                values ('test.rel.spent', 'running', 2, 2, now() - interval '1 minute', now() - interval '6 minutes')
                returning id`,
      "spent job"
    );
    const retry = one(
      await sql`insert into public.jobs (name, status, attempts, max_attempts, lease_until, started_at)
                values ('test.rel.retry', 'running', 1, 2, now() - interval '1 minute', now() - interval '6 minutes')
                returning id`,
      "retryable job"
    );
    const live = one(
      await sql`insert into public.jobs (name, status, attempts, max_attempts, lease_until, started_at)
                values ('test.rel.live', 'running', 1, 2, now() + interval '4 minutes', now())
                returning id`,
      "job still inside its lease"
    );

    const counts = one(await sql`select requeued, failed from public.rpc_reap_jobs()`, "reap counts");
    expect(Number(counts.failed)).toBeGreaterThanOrEqual(1);
    expect(Number(counts.requeued)).toBeGreaterThanOrEqual(1);

    const rows = await sql`select id, status, finished_at, run_after > now() as deferred, last_error
                             from public.jobs where id = any(${[spent.id, retry.id, live.id]})`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(spent.id)?.status).toBe("failed");
    expect(byId.get(spent.id)?.finished_at).not.toBeNull();
    expect(byId.get(retry.id)?.status).toBe("pending");
    expect(byId.get(retry.id)?.deferred).toBe(true);
    expect(byId.get(live.id)?.status).toBe("running");
  });

  it("claim skips a pending job that has already used max_attempts", async () => {
    await sql`insert into public.jobs (name, idempotency_key, attempts, max_attempts)
              values ('test.rel.claim', 'spent', 3, 3), ('test.rel.claim', 'fresh', 0, 3)`;
    const claimed = await sql`select idempotency_key from public.rpc_claim_jobs(array['test.rel.claim'], 10)`;
    expect(claimed.map((r) => r.idempotency_key)).toEqual(["fresh"]);
  });

  it("finish applies only to a running row, under the attempt that claimed it", async () => {
    const j = one(
      await sql`insert into public.jobs (name, status, attempts, max_attempts, lease_until)
                values ('test.rel.finish', 'running', 2, 5, now() + interval '5 minutes') returning id`,
      "running job"
    );
    // A stale worker from attempt 1 finishing late is refused.
    const stale = one(await sql`select public.rpc_finish_job(${j.id}, true, null, 1) as applied`, "stale");
    expect(stale.applied).toBe(false);
    expect(one(await sql`select status from public.jobs where id = ${j.id}`, "job").status).toBe("running");

    const current = one(
      await sql`select public.rpc_finish_job(${j.id}, true, null, 2) as applied`,
      "current"
    );
    expect(current.applied).toBe(true);
    expect(one(await sql`select status from public.jobs where id = ${j.id}`, "job").status).toBe("succeeded");

    // Already finished: a second finish (any attempt) changes nothing.
    const again = one(await sql`select public.rpc_finish_job(${j.id}, false, 'late') as applied`, "again");
    expect(again.applied).toBe(false);
    expect(one(await sql`select status from public.jobs where id = ${j.id}`, "job").status).toBe("succeeded");
  });
});

// ── APX-21 ───────────────────────────────────────────────────────────────────
describe("project progress follows its packages (APX-21)", () => {
  it("adding a bigger package re-weights the project without any task edit", async () => {
    const project = await fixtureProject("REL21A");
    const done = await addPackage(project, 100);
    const phase = await addPhase(project, done);
    await addTask(project, done, phase, 100);
    expect(await projectProgress(project)).toBe(100);

    await addPackage(project, 300); // 0% progress, three times the weight
    expect(await projectProgress(project)).toBe(25);
  });

  it("changing an allocation, or soft-deleting a package, re-weights it", async () => {
    const project = await fixtureProject("REL21B");
    const done = await addPackage(project, 100);
    const phase = await addPhase(project, done);
    await addTask(project, done, phase, 100);
    const pending = await addPackage(project, 100);
    expect(await projectProgress(project)).toBe(50);

    await sql`update public.packages set allocated_amount = 300 where id = ${pending}`;
    expect(await projectProgress(project)).toBe(25);

    await sql`update public.packages set deleted_at = now() where id = ${pending}`;
    expect(await projectProgress(project)).toBe(100);
  });

  it("with every allocation at 0, falls back to the plain mean instead of 0%", async () => {
    const project = await fixtureProject("REL21C");
    const done = await addPackage(project, 0);
    const phase = await addPhase(project, done);
    await addTask(project, done, phase, 100);
    await addPackage(project, 0);
    expect(await projectProgress(project)).toBe(50);
  });
});

// ── APX-43 ───────────────────────────────────────────────────────────────────
describe("a manual completion yields to real tasks (APX-43)", () => {
  it("adding a 0% task un-completes the phase and returns it to unresolved", async () => {
    const project = await fixtureProject("REL43");
    const pkg = await addPackage(project, 100);
    const phase = await addPhase(project, pkg);
    await sql`update public.phases set billing_status = 'billable', manual_complete_at = now(),
                     manual_complete_by = ${SEED.adminProfile}
               where id = ${phase}`;
    expect(
      one(await sql`select is_complete from public.v_phase_billing where phase_id = ${phase}`, "phase")
        .is_complete
    ).toBe(true);

    const task = await addTask(project, pkg, phase, 0);
    const after = one(
      await sql`select vb.is_complete, ph.billing_status
                  from public.v_phase_billing vb join public.phases ph on ph.id = vb.phase_id
                 where vb.phase_id = ${phase}`,
      "phase after a task"
    );
    expect(after.is_complete).toBe(false);
    expect(after.billing_status).toBe("unresolved");
    const billable = await sql`select 1 from public.v_billable_now where source_id = ${phase}`;
    expect(billable.length).toBe(0);

    // The task trigger (not only rpc_set_task_progress) flips it back.
    await sql`update public.tasks set progress_pct = 100 where id = ${task}`;
    expect(
      one(await sql`select billing_status from public.phases where id = ${phase}`, "phase").billing_status
    ).toBe("billable");
  });

  it("never touches a phase that is already billed", async () => {
    const project = await fixtureProject("REL43B");
    const pkg = await addPackage(project, 100);
    const phase = await addPhase(project, pkg);
    await sql`update public.phases set billing_status = 'billed' where id = ${phase}`;
    await addTask(project, pkg, phase, 0);
    expect(
      one(await sql`select billing_status from public.phases where id = ${phase}`, "phase").billing_status
    ).toBe("billed");
  });
});

// ── APX-45 / APX-66 ──────────────────────────────────────────────────────────
describe("package seq_no and updated_at (APX-45, APX-66)", () => {
  it("allocates seq_no past soft-deleted rows, so a deleted package's number is never reused", async () => {
    const project = await fixtureProject("REL45A");
    const first = await addPackage(project, 0);
    const second = await addPackage(project, 0);
    await sql`update public.packages set deleted_at = now() where id = ${second}`;
    const third = await addPackage(project, 0);
    const seqs = await sql`select id, seq_no from public.packages where id = any(${[first, second, third]})`;
    const seqOf = new Map(seqs.map((r) => [r.id, Number(r.seq_no)]));
    expect([seqOf.get(first), seqOf.get(second), seqOf.get(third)]).toEqual([1, 2, 3]);
  });

  it("two concurrent creates under one project never collide", async () => {
    const project = await fixtureProject("REL45B");
    const a = connect();
    const b = connect();
    try {
      await Promise.all([
        a`insert into public.packages (org_id, project_id, name) values (${SEED.org}, ${project}, 'A')`,
        b`insert into public.packages (org_id, project_id, name) values (${SEED.org}, ${project}, 'B')`,
      ]);
    } finally {
      await a.end({ timeout: 5 });
      await b.end({ timeout: 5 });
    }
    const seqs = await sql`select seq_no from public.packages where project_id = ${project} order by seq_no`;
    expect(seqs.map((r) => Number(r.seq_no))).toEqual([1, 2]);
  });

  it("allocates phase seq_no per package the same way", async () => {
    const project = await fixtureProject("REL45C");
    const pkg = await addPackage(project, 0);
    await addPhase(project, pkg);
    const second = await addPhase(project, pkg);
    expect(
      Number(one(await sql`select seq_no from public.phases where id = ${second}`, "phase").seq_no)
    ).toBe(2);
  });

  it("a progress-only write keeps updated_at; a real edit moves it", async () => {
    const project = await fixtureProject("REL45D");
    const pkg = await addPackage(project, 100);
    const phase = await addPhase(project, pkg);
    const before = one(
      await sql`select updated_at::text as ts from public.packages where id = ${pkg}`,
      "pkg"
    ).ts;

    await addTask(project, pkg, phase, 60); // fn_recompute_progress writes packages.progress_pct
    const afterTask = one(
      await sql`select updated_at::text as ts, progress_pct from public.packages where id = ${pkg}`,
      "pkg after task"
    );
    expect(Number(afterTask.progress_pct)).toBe(60);
    expect(afterTask.ts).toBe(before);

    await sql`update public.packages set name = 'Renamed' where id = ${pkg}`;
    const afterEdit = one(
      await sql`select updated_at::text as ts from public.packages where id = ${pkg}`,
      "pkg"
    ).ts;
    expect(afterEdit).not.toBe(before);
  });

  it("a billing_status flip from the task trigger keeps phases.updated_at (Edit Phase's token)", async () => {
    const project = await fixtureProject("REL45E");
    const pkg = await addPackage(project, 100);
    const phase = await addPhase(project, pkg);
    const before = one(
      await sql`select updated_at::text as ts from public.phases where id = ${phase}`,
      "phase"
    ).ts;

    await addTask(project, pkg, phase, 100); // the trigger sets billing_status = 'billable'
    const after = one(
      await sql`select updated_at::text as ts, billing_status from public.phases where id = ${phase}`,
      "phase after task"
    );
    expect(after.billing_status).toBe("billable");
    expect(after.ts).toBe(before);

    await sql`update public.phases set name = 'Renamed phase' where id = ${phase}`;
    const edited = one(
      await sql`select updated_at::text as ts from public.phases where id = ${phase}`,
      "phase"
    ).ts;
    expect(edited).not.toBe(before);
  });

  it("a hard delete of a project with evidence is refused (RESTRICT, not CASCADE)", async () => {
    const project = await fixtureProject("REL66");
    const pkg = await addPackage(project, 0);
    await sql`insert into public.approvals (org_id, project_id, package_id, ref_no, type, item, status, requested_by, created_by)
              values (${SEED.org}, ${project}, ${pkg}, ${"AP-REL66-" + project.slice(0, 8)}, 'material_sample',
                      'Evidence', 'pending', ${SEED.siteProfile}, ${SEED.siteProfile})`;
    await expect(sql`delete from public.projects where id = ${project}`).rejects.toThrow(
      /approvals_project_id_fkey|violates foreign key/
    );
  });
});

// ── APX-06 ───────────────────────────────────────────────────────────────────
describe("rpc_r2_keys_referenced (APX-06)", () => {
  let project = "";
  beforeAll(async () => {
    project = await fixtureProject("REL06");
  });

  it("returns exactly the referenced subset, including soft-deleted rows and thumbnails", async () => {
    const base = `org/${SEED.org}/project/${project}/project/${project}`;
    await sql`insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, thumb_r2_key, file_name, mime_type, size_bytes, uploaded_by)
              values (${SEED.org}, ${project}, 'project', ${project}, ${base + "/live.jpg"}, ${"thumb/" + base + "/live.jpg"},
                      'live.jpg', 'image/jpeg', 10, ${SEED.adminProfile}),
                     (${SEED.org}, ${project}, 'project', ${project}, ${base + "/gone.jpg"}, null,
                      'gone.jpg', 'image/jpeg', 10, ${SEED.adminProfile})`;
    await sql`update public.attachments set deleted_at = now() where r2_key = ${base + "/gone.jpg"}`;

    const asked = [
      base + "/live.jpg",
      "thumb/" + base + "/live.jpg",
      base + "/gone.jpg",
      base + "/orphan.jpg",
    ];
    const rows = await sql`select k from public.rpc_r2_keys_referenced(${asked}::text[]) as k`;
    expect(rows.map((r) => r.k).sort()).toEqual(asked.slice(0, 3).sort());
  });

  it("is not executable by authenticated users", async () => {
    const grants = await sql`select grantee from information_schema.role_routine_grants
                              where routine_schema = 'public' and routine_name = 'rpc_r2_keys_referenced'`;
    expect(grants.map((g) => g.grantee)).not.toContain("authenticated");
  });
});

// ── APX-52 ───────────────────────────────────────────────────────────────────
describe("rpc_portfolio_money (APX-52)", () => {
  it("sums in numeric and returns text, with a grand-total row", async () => {
    const project = await fixtureProject("REL52");
    await sql`insert into public.packages (org_id, project_id, name, allocated_amount, internal_amount)
              values (${SEED.org}, ${project}, 'A', 0.10, 0.05), (${SEED.org}, ${project}, 'B', 0.20, 0.05)`;
    const rows =
      await sql`select project_id, allocated, internal from public.rpc_portfolio_money(${[project]}::uuid[])`;
    const perProject = rows.find((r) => r.project_id === project);
    const total = rows.find((r) => r.project_id === null);
    // 0.1 + 0.2 is 0.30000000000000004 in a float sum; exactly 0.30 in numeric.
    expect(perProject?.allocated).toBe("0.30");
    expect(total?.allocated).toBe("0.30");
    expect(perProject?.internal).toBe("0.10");
  });
});

describe("the shell aggregates through real sessions (APX-52)", () => {
  it("rpc_portfolio_money gives an admin per-project figures and a site session none", async () => {
    const admin = await signedInAs(ADMIN_EMAIL);
    const adminRes = await admin.rpc("rpc_portfolio_money", { p_project_ids: [SEED.project] });
    expect(adminRes.error).toBeNull();
    const adminRows = (adminRes.data ?? []) as { project_id: string | null; internal: string }[];
    expect(adminRows.some((r) => r.project_id === SEED.project)).toBe(true);

    // Invoker-mode over the admin-only packages policy: a site session sees
    // no package rows, so no per-project row and a zero total.
    const site = await signedInAs(SITE_EMAIL);
    const siteRes = await site.rpc("rpc_portfolio_money", { p_project_ids: [SEED.project] });
    expect(siteRes.error).toBeNull();
    const siteRows = (siteRes.data ?? []) as { project_id: string | null; internal: string }[];
    expect(siteRows.filter((r) => r.project_id !== null)).toEqual([]);
    for (const r of siteRows) expect(Number(r.internal)).toBe(0);
  });

  it("rpc_portfolio_money gives a client session no internal figures either", async () => {
    const clientSession = await signedInAs(CLIENT_EMAIL);
    const res = await clientSession.rpc("rpc_portfolio_money", { p_project_ids: [SEED.project] });
    expect(res.error).toBeNull();
    const rows = (res.data ?? []) as { project_id: string | null; internal: string; committed: string }[];
    expect(rows.filter((r) => r.project_id !== null)).toEqual([]);
    for (const r of rows) {
      expect(Number(r.internal)).toBe(0);
      expect(Number(r.committed)).toBe(0);
    }
  });
});
