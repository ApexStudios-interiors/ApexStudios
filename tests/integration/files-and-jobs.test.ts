import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { connect, SEED } from "./db";
import { one } from "./expect-row";

/**
 * build/06-files-jobs-daily-updates.md §5. AGENTS.md database rule 8: RLS
 * and RPCs are exercised through real signed-in supabase-js sessions, never
 * the privileged `sql` connection — that connection is test SETUP/teardown
 * only, same role it plays in every other integration file.
 *
 * `lib/jobs/runner.ts`'s `reap()` cannot be imported directly here — it (and
 * everything under `lib/`) carries `import "server-only"`, which throws
 * outside a real Next.js server build, vitest's plain Node environment
 * included. Its reap query is a single plain UPDATE with no business logic
 * beyond the WHERE clause (the same "thin wrapper" trust every RPC-calling
 * test file already extends to `rpc_claim_jobs`/`rpc_finish_job`), so the
 * test below runs that exact query directly instead.
 *
 * What this file does NOT cover: `confirmUpload`'s HeadObject check, a real
 * thumbnail render, and the orphan sweep actually deleting anything — all
 * three need a real R2 bucket, which does not exist yet (docs/decisions.md,
 * "Build 06 prerequisites answered"). `enqueue()` (lib/jobs/enqueue.ts) also
 * isn't called directly here: it calls `next/headers`'s `cookies()` through
 * `lib/supabase/server.ts`, which throws outside a real Next.js request —
 * `rpc_enqueue_job` itself is exercised directly below instead, which is the
 * whole of what `enqueue()` delegates to.
 */

const PASSWORD = "apex-dev-only";
const sql = connect();
const cleanupJobIds: string[] = [];
const cleanupAttachmentIds: string[] = [];
const cleanupUpdateIds: string[] = [];

afterEach(async () => {
  if (cleanupJobIds.length) await sql`delete from public.jobs where id = any(${cleanupJobIds})`;
  if (cleanupAttachmentIds.length)
    await sql`delete from public.attachments where id = any(${cleanupAttachmentIds})`;
  if (cleanupUpdateIds.length)
    await sql`delete from public.daily_updates where id = any(${cleanupUpdateIds})`;
  cleanupJobIds.length = 0;
  cleanupAttachmentIds.length = 0;
  cleanupUpdateIds.length = 0;
});
afterAll(() => sql.end({ timeout: 5 }));

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

describe("rpc_enqueue_job", () => {
  it("a real site session can enqueue attachment.thumbnail", async () => {
    const site = await signedInAs("ravi@beapex.in");
    const idempotencyKey = `test-enqueue-${crypto.randomUUID()}`;
    const { data: id, error } = await site.rpc("rpc_enqueue_job", {
      p_name: "attachment.thumbnail",
      p_payload: { attachmentId: "irrelevant-for-this-test" },
      p_idempotency_key: idempotencyKey,
    });
    expect(error).toBeNull();
    expect(id).toBeTruthy();
    if (id) cleanupJobIds.push(id);
  });

  it("T-24: enqueuing the same (name, idempotency_key) twice returns the same row, at the application RPC too", async () => {
    const site = await signedInAs("ravi@beapex.in");
    const idempotencyKey = `test-idem-${crypto.randomUUID()}`;
    const first = await site.rpc("rpc_enqueue_job", {
      p_name: "attachment.thumbnail",
      p_payload: {},
      p_idempotency_key: idempotencyKey,
    });
    const second = await site.rpc("rpc_enqueue_job", {
      p_name: "attachment.thumbnail",
      p_payload: {},
      p_idempotency_key: idempotencyKey,
    });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);
    if (first.data) cleanupJobIds.push(first.data);
  });

  it("refuses a job name a real user session has no business enqueueing", async () => {
    const site = await signedInAs("ravi@beapex.in");
    const { error } = await site.rpc("rpc_enqueue_job", { p_name: "backup.nightly", p_payload: {} });
    expect(error?.message).toMatch(/FORBIDDEN/);
  });
});

describe("rpc_retry_job", () => {
  it("resets a failed job to pending with a fresh attempts budget", async () => {
    const job = one(
      await sql`insert into public.jobs (name, payload, status, attempts, max_attempts, last_error, finished_at)
                values ('test.retry', '{}'::jsonb, 'failed', 5, 5, 'boom', now()) returning id`,
      "inserted failed job"
    );
    cleanupJobIds.push(job.id);

    const admin = await signedInAs("suresh@beapex.in");
    const { error } = await admin.rpc("rpc_retry_job", { p_id: job.id });
    expect(error).toBeNull();

    const after = one(
      await sql`select status, attempts, last_error, finished_at from public.jobs where id = ${job.id}`,
      "job after retry"
    );
    expect(after.status).toBe("pending");
    expect(after.attempts).toBe(0);
    expect(after.last_error).toBeNull();
    expect(after.finished_at).toBeNull();
  });

  it("refuses a non-admin session", async () => {
    const job = one(
      await sql`insert into public.jobs (name, payload, status, attempts, max_attempts)
                values ('test.retry-refused', '{}'::jsonb, 'failed', 5, 5) returning id`,
      "inserted failed job"
    );
    cleanupJobIds.push(job.id);

    const site = await signedInAs("ravi@beapex.in");
    const { error } = await site.rpc("rpc_retry_job", { p_id: job.id });
    expect(error?.message).toMatch(/FORBIDDEN/);
  });

  it("refuses a job that isn't actually failed", async () => {
    const job = one(
      await sql`insert into public.jobs (name, payload, status) values ('test.retry-not-failed', '{}'::jsonb, 'pending') returning id`,
      "inserted pending job"
    );
    cleanupJobIds.push(job.id);

    const admin = await signedInAs("suresh@beapex.in");
    const { error } = await admin.rpc("rpc_retry_job", { p_id: job.id });
    expect(error?.message).toMatch(/NOT_FOUND/);
  });
});

describe("T-23: the reaper requeues a job whose lease_until has passed", () => {
  it("requeues jobs.reap's own query — see the file header for why it isn't imported directly", async () => {
    const stuck = one(
      await sql`insert into public.jobs (name, payload, status, lease_until, started_at)
                values ('test.reap', '{}'::jsonb, 'running', now() - interval '10 minutes', now() - interval '10 minutes')
                returning id`,
      "inserted stuck job"
    );
    const fresh = one(
      await sql`insert into public.jobs (name, payload, status, lease_until, started_at)
                values ('test.reap-still-running', '{}'::jsonb, 'running', now() + interval '5 minutes', now())
                returning id`,
      "inserted a genuinely still-running job"
    );
    cleanupJobIds.push(stuck.id, fresh.id);

    // lib/jobs/runner.ts's reap(), verbatim.
    const requeued = await sql`
      update public.jobs
         set status = 'pending', lease_until = null, last_error = 'lease expired — worker timed out'
       where status = 'running' and lease_until < now()
       returning id`;
    expect(requeued.length).toBeGreaterThanOrEqual(1);

    const after = one(
      await sql`select status, lease_until, last_error from public.jobs where id = ${stuck.id}`,
      "stuck job after reap"
    );
    expect(after.status).toBe("pending");
    expect(after.lease_until).toBeNull();
    expect(after.last_error).toMatch(/lease expired/);

    const untouched = one(
      await sql`select status from public.jobs where id = ${fresh.id}`,
      "still-running job after reap"
    );
    expect(untouched.status).toBe("running");
  });
});

describe("attachments RLS — the boundary getDownloadUrl and requestUploadUrl both rely on", () => {
  it("T-19-equivalent: a session cannot see an attachment on a project it is not a member of", async () => {
    // Ravi (site) is a member of c1 only (BHEL Nagnar Club House) — c2 (the
    // Entrance Arch project) is genuinely another project to this session,
    // not a fixture with no real membership data behind it.
    const otherProjectAttachment = one(
      await sql`insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by)
                values (${SEED.org}, '00000000-0000-4000-8000-0000000000c2', 'daily_update', gen_random_uuid(), ${"org/test/other-project-" + crypto.randomUUID() + ".jpg"}, 'x.jpg', 'image/jpeg', 100, ${SEED.clientProfile})
                returning id`,
      "inserted an attachment on the OTHER project"
    );
    cleanupAttachmentIds.push(otherProjectAttachment.id);

    const site = await signedInAs("ravi@beapex.in");
    const { data, error } = await site
      .from("attachments")
      .select("id")
      .eq("id", otherProjectAttachment.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("the same session CAN see an attachment on its own project", async () => {
    const ownProjectAttachment = one(
      await sql`insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by)
                values (${SEED.org}, ${SEED.project}, 'daily_update', gen_random_uuid(), ${"org/test/own-project-" + crypto.randomUUID() + ".jpg"}, 'x.jpg', 'image/jpeg', 100, ${SEED.siteProfile})
                returning id`,
      "inserted an attachment on the site session's own project"
    );
    cleanupAttachmentIds.push(ownProjectAttachment.id);

    const site = await signedInAs("ravi@beapex.in");
    const { data, error } = await site
      .from("attachments")
      .select("id")
      .eq("id", ownProjectAttachment.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ownProjectAttachment.id);
  });
});

describe("daily_updates 24-hour edit window (RLS, not just the action's own check)", () => {
  it("a fresh update is editable by its author", async () => {
    const update = one(
      await sql`insert into public.daily_updates (org_id, project_id, package_id, update_date, body, author_id)
                values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, current_date, 'fresh', ${SEED.siteProfile})
                returning id`,
      "inserted a fresh update"
    );
    cleanupUpdateIds.push(update.id);

    const site = await signedInAs("ravi@beapex.in");
    const { data, error } = await site
      .from("daily_updates")
      .update({ body: "edited" })
      .eq("id", update.id)
      .select("id");
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("an update edited at 25 hours is refused — RLS excludes the row, not a thrown error", async () => {
    const update = one(
      await sql`insert into public.daily_updates (org_id, project_id, package_id, update_date, body, author_id, created_at)
                values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, current_date - 2, 'stale', ${SEED.siteProfile}, now() - interval '25 hours')
                returning id`,
      "inserted a 25-hour-old update"
    );
    cleanupUpdateIds.push(update.id);

    const site = await signedInAs("ravi@beapex.in");
    const { data, error } = await site
      .from("daily_updates")
      .update({ body: "too late" })
      .eq("id", update.id)
      .select("id");
    expect(error).toBeNull();
    expect(data?.length).toBe(0);

    const unchanged = one(
      await sql`select body from public.daily_updates where id = ${update.id}`,
      "the update after the refused edit"
    );
    expect(unchanged.body).toBe("stale");
  });
});
