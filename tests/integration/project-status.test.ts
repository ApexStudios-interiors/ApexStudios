import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { connect, SEED } from "./db";
import { one } from "./expect-row";

/**
 * APX-11 / APX-41 / APX-12 from real signed-in sessions (AGENTS.md database
 * rule 8): rpc_set_project_status's legal and illegal transitions, the
 * reason a reopen needs, its audit row and its row lock under two concurrent
 * calls; the read-only guards as a Site Supervisor meets them; and a site
 * membership added and removed by an admin. The privileged `sql` connection
 * only sets fixtures up and puts them back.
 */

const PASSWORD = "apex-dev-only";
const ARCH = "00000000-0000-4000-8000-0000000000c2"; // BHEL-ARCH, seeded 'planning'
const sql = connect();

function anonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.");
  return createClient(url, key);
}
async function signedInAs(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return client;
}

async function statusOf(projectId: string): Promise<string> {
  const rows = await sql<
    { status: string }[]
  >`select status::text as status from public.projects where id = ${projectId}`;
  return one(rows, "project").status;
}

let admin: SupabaseClient;
let site: SupabaseClient;
let originalStatus: { c1: string; c2: string };

beforeAll(async () => {
  admin = await signedInAs("suresh@beapex.in");
  site = await signedInAs("ravi@beapex.in");
  originalStatus = { c1: await statusOf(SEED.project), c2: await statusOf(ARCH) };
});

afterAll(async () => {
  // As the migration owner, which the status guard does not apply to.
  await sql`update public.projects set status = ${originalStatus.c1}::public.project_status where id = ${SEED.project}`;
  await sql`update public.projects set status = ${originalStatus.c2}::public.project_status where id = ${ARCH}`;
  await sql.end({ timeout: 5 });
});

describe("rpc_set_project_status (APX-11)", () => {
  beforeAll(async () => {
    await sql`update public.projects set status = 'planning' where id = ${ARCH}`;
  });

  it("refuses a status change made as a plain update", async () => {
    const { error } = await admin.from("projects").update({ status: "active" }).eq("id", ARCH);
    expect(error?.message).toMatch(/^ILLEGAL_TRANSITION:/);
    expect(await statusOf(ARCH)).toBe("planning");
  });

  it("refuses an illegal transition", async () => {
    const { error } = await admin.rpc("rpc_set_project_status", {
      p_project_id: ARCH,
      p_status: "completed",
    });
    expect(error?.message).toMatch(/^ILLEGAL_TRANSITION:/);
  });

  it("refuses a site supervisor", async () => {
    const { error } = await site.rpc("rpc_set_project_status", {
      p_project_id: SEED.project,
      p_status: "on_hold",
    });
    expect(error?.message).toMatch(/^FORBIDDEN:/);
  });

  it("moves planning → active → completed, stamping completed_at and auditing each step", async () => {
    expect(
      (await admin.rpc("rpc_set_project_status", { p_project_id: ARCH, p_status: "active" })).error
    ).toBeNull();
    expect(
      (await admin.rpc("rpc_set_project_status", { p_project_id: ARCH, p_status: "completed" })).error
    ).toBeNull();
    const rows = await sql<
      { completed_at: Date | null }[]
    >`select completed_at from public.projects where id = ${ARCH}`;
    expect(one(rows, "project").completed_at).not.toBeNull();
    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from public.audit_log
       where entity_type = 'project' and entity_id = ${ARCH} and action = 'transition'
         and created_at > now() - interval '5 minutes'`;
    expect(one(audit, "count").n).toBeGreaterThanOrEqual(2);
  });

  it("needs a reason to reopen", async () => {
    const without = await admin.rpc("rpc_set_project_status", { p_project_id: ARCH, p_status: "active" });
    expect(without.error?.message).toMatch(/^REASON_REQUIRED:/);
    const withReason = await admin.rpc("rpc_set_project_status", {
      p_project_id: ARCH,
      p_status: "active",
      p_reason: "Client added a canopy",
    });
    expect(withReason.error).toBeNull();
    expect(await statusOf(ARCH)).toBe("active");
  });

  it("serialises two concurrent calls on the row lock: one moves it, the other is a no-op", async () => {
    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from public.audit_log where entity_type = 'project' and entity_id = ${ARCH}`;
    const [a, b] = await Promise.all([
      admin.rpc("rpc_set_project_status", { p_project_id: ARCH, p_status: "on_hold" }),
      admin.rpc("rpc_set_project_status", { p_project_id: ARCH, p_status: "on_hold" }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(await statusOf(ARCH)).toBe("on_hold");
    const after = await sql<{ n: number }[]>`
      select count(*)::int as n from public.audit_log where entity_type = 'project' and entity_id = ${ARCH}`;
    expect(one(after, "count").n - one(before, "count").n).toBe(1);
  });
});

describe("read-only projects (APX-41), as a Site Supervisor", () => {
  let taskId: string;

  beforeAll(async () => {
    const rows = await sql<{ id: string }[]>`
      select id from public.tasks where project_id = ${SEED.project} and deleted_at is null order by id limit 1`;
    taskId = one(rows, "task").id;
  });

  it("refuses task progress on an archived project", async () => {
    await sql`update public.projects set status = 'archived' where id = ${SEED.project}`;
    const { error } = await site.rpc("rpc_set_task_progress", { p_task_id: taskId, p_pct: 50 });
    expect(error?.message).toMatch(/^PROJECT_ARCHIVED:/);
  });

  it("still allows task progress on a completed project", async () => {
    await sql`update public.projects set status = 'completed' where id = ${SEED.project}`;
    const rows = await sql<
      { progress_pct: number }[]
    >`select progress_pct from public.tasks where id = ${taskId}`;
    const pct = one(rows, "task").progress_pct;
    const { error } = await site.rpc("rpc_set_task_progress", { p_task_id: taskId, p_pct: pct });
    expect(error).toBeNull();
  });
});

describe("site team membership (APX-12)", () => {
  it("an admin can put a site supervisor on a project and take them off again", async () => {
    await sql`delete from public.project_members where project_id = ${ARCH} and profile_id = ${SEED.siteProfile}`;

    const before = await site.from("projects").select("id").eq("id", ARCH);
    expect(before.data).toEqual([]);

    const added = await admin
      .from("project_members")
      .insert({ project_id: ARCH, profile_id: SEED.siteProfile, added_by: SEED.adminProfile });
    expect(added.error).toBeNull();
    const visible = await site.from("projects").select("id").eq("id", ARCH);
    expect(visible.data?.length).toBe(1);

    const removed = await admin
      .from("project_members")
      .delete()
      .eq("project_id", ARCH)
      .eq("profile_id", SEED.siteProfile);
    expect(removed.error).toBeNull();
    const after = await site.from("projects").select("id").eq("id", ARCH);
    expect(after.data).toEqual([]);
  });
});
