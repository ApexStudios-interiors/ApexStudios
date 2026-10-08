import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { connect, SEED } from "./db";
import { one } from "./expect-row";
import { billPdfJobKey } from "@/features/billing/pdf";

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

  /**
   * The other side of T-24, and the regression this asserts is real: a bill
   * rejected by the client goes back to draft at `revision + 1`
   * (`rpc_transition_bill`), and the admin resubmits it. Keyed on
   * `${billId}:submitted` — no revision — the resubmission hit
   * `jobs_idem_uq` and produced NO second job, so the PDF the client
   * certified against was still the pre-rejection one. `billPdfJobKey`
   * (features/billing/pdf.ts) is what `features/billing/actions.ts` now
   * passes; this proves it actually escapes the dedup the old key hit.
   */
  it("a resubmitted bill's bill.pdf key enqueues a second job, where the revision-blind key did not", async () => {
    const admin = await signedInAs("suresh@beapex.in");
    const billId = crypto.randomUUID();

    const enqueueWith = async (idempotencyKey: string) => {
      const { data, error } = await admin.rpc("rpc_enqueue_job", {
        p_name: "bill.pdf",
        p_payload: { billId },
        p_idempotency_key: idempotencyKey,
      });
      expect(error).toBeNull();
      if (data) cleanupJobIds.push(data);
      return data as string;
    };

    // The pre-fix key: submit, reject, resubmit all collapse onto one job.
    const blindFirst = await enqueueWith(`${billId}:submitted`);
    const blindSecond = await enqueueWith(`${billId}:submitted`);
    expect(blindSecond).toBe(blindFirst);

    // The fix: revision 1's submission and revision 2's resubmission are
    // separate jobs, while a retried enqueue of either is still just one.
    const revisionOne = await enqueueWith(billPdfJobKey(billId, 1));
    const revisionOneAgain = await enqueueWith(billPdfJobKey(billId, 1));
    const revisionTwo = await enqueueWith(billPdfJobKey(billId, 2));
    expect(revisionOneAgain).toBe(revisionOne);
    expect(revisionTwo).not.toBe(revisionOne);
    expect(revisionTwo).not.toBe(blindFirst);

    const rows = await sql`select count(*)::int as n from public.jobs
                            where name = 'bill.pdf' and payload->>'billId' = ${billId}`;
    expect(one(rows, "bill.pdf job count").n).toBe(3);
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

/**
 * Migration 20261007090003: trg_daily_updates_ancestry. An update's package
 * must belong to its project, on every write path — the author's own
 * PostgREST insert included. The error is the domain NOT_FOUND (P0002), as
 * the approval and stock-request ancestry triggers' are.
 */
describe("daily_updates — project → package ancestry", () => {
  /** Seed: project c2's only package (ravi is not a member of c2). */
  const OTHER_PROJECT_PACKAGE = "00000000-0000-4000-8000-0000000000e7";

  async function insertVia(as: SupabaseClient, packageId: string) {
    const id = crypto.randomUUID();
    const result = await as
      .from("daily_updates")
      .insert({
        id,
        org_id: SEED.org,
        project_id: SEED.project,
        package_id: packageId,
        update_date: "2026-10-07",
        body: "Ancestry test update",
        author_id: SEED.siteProfile,
        created_by: SEED.siteProfile,
      })
      .select("id");
    cleanupUpdateIds.push(id);
    return result;
  }

  it("accepts a package of the project", async () => {
    const site = await signedInAs("ravi@beapex.in");

    const { data, error } = await insertVia(site, SEED.poolPackage);

    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("refuses a package from another project with NOT_FOUND", async () => {
    const site = await signedInAs("ravi@beapex.in");

    const { data, error } = await insertVia(site, OTHER_PROJECT_PACKAGE);

    expect(data).toBeNull();
    expect(error?.code).toBe("P0002");
    expect(error?.message).toMatch(/^NOT_FOUND: package .* does not exist in this project$/);
  });

  it("refuses an UPDATE that moves an update onto another project's package", async () => {
    // Directly on the table (the privileged connection skips RLS and has no
    // auth.uid(), so the body-only rule does not apply): the only thing that
    // can refuse this write is the ancestry trigger itself.
    const update = one(
      await sql`insert into public.daily_updates (org_id, project_id, package_id, update_date, body, author_id)
                values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, current_date, 'ancestry', ${SEED.siteProfile})
                returning id`,
      "inserted an update"
    );
    cleanupUpdateIds.push(update.id);

    await expect(
      sql`update public.daily_updates set package_id = ${OTHER_PROJECT_PACKAGE} where id = ${update.id}`
    ).rejects.toThrow(/NOT_FOUND: package .* does not exist in this project/);

    const row = one(
      await sql`select project_id, package_id from public.daily_updates where id = ${update.id}`,
      "unchanged update"
    );
    expect(row).toEqual({ project_id: SEED.project, package_id: SEED.poolPackage });
  });
});

/**
 * Migration 20261007090004: trg_daily_updates_body_only. Inside the 24-hour
 * window du_update_author lets the author update their row; the trigger lets
 * that update change only `body` (and `updated_by`, to themselves) — never
 * where, when or by whom the entry is filed. Refusals are FORBIDDEN (42501).
 * The 24-hour window itself is the describe block above, unchanged.
 */
describe("daily_updates — an author's edit changes the body only", () => {
  /** Seed: c1's second package, and project c2 with its only package. */
  const SAME_PROJECT_OTHER_PACKAGE = "00000000-0000-4000-8000-0000000000e2";
  const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000c2";
  const OTHER_PROJECT_PACKAGE = "00000000-0000-4000-8000-0000000000e7";

  async function freshUpdate(): Promise<string> {
    const update = one(
      await sql`insert into public.daily_updates (org_id, project_id, package_id, update_date, body, author_id, created_by)
                values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, '2026-10-06', 'original', ${SEED.siteProfile}, ${SEED.siteProfile})
                returning id`,
      "inserted a fresh update"
    );
    cleanupUpdateIds.push(update.id);
    return update.id;
  }

  async function rowOf(id: string) {
    return one(
      await sql`select project_id, package_id, update_date::text as update_date, author_id, body
                  from public.daily_updates where id = ${id}`,
      "the update"
    );
  }

  const ORIGINAL = {
    project_id: SEED.project,
    package_id: SEED.poolPackage,
    update_date: "2026-10-06",
    author_id: SEED.siteProfile,
    body: "original",
  };

  it("still lets the author edit the body within 24 hours, exactly as editDailyUpdate sends it", async () => {
    const id = await freshUpdate();
    const site = await signedInAs("ravi@beapex.in");

    const { data, error } = await site
      .from("daily_updates")
      .update({ body: "fixed a typo", updated_by: SEED.siteProfile })
      .eq("id", id)
      .select("id");

    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(await rowOf(id)).toEqual({ ...ORIGINAL, body: "fixed a typo" });
  });

  it.each([
    [
      "project_id (moved with a package that matches, so only this rule can refuse it)",
      { project_id: OTHER_PROJECT, package_id: OTHER_PROJECT_PACKAGE },
    ],
    ["package_id (another package of the same project)", { package_id: SAME_PROJECT_OTHER_PACKAGE }],
    ["update_date", { update_date: "2026-09-01" }],
    ["author_id", { author_id: SEED.adminProfile }],
    ["created_at (restarting the 24-hour clock)", { created_at: new Date().toISOString() }],
  ])("refuses an author's change to %s", async (_label, change) => {
    const id = await freshUpdate();
    const site = await signedInAs("ravi@beapex.in");

    const { data, error } = await site
      .from("daily_updates")
      .update({ ...change, body: "sneaked in" })
      .eq("id", id)
      .select("id");

    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await rowOf(id)).toEqual(ORIGINAL);
  });

  it("refuses updated_by naming someone other than the editor", async () => {
    const id = await freshUpdate();
    const site = await signedInAs("ravi@beapex.in");

    const { error } = await site
      .from("daily_updates")
      .update({ body: "edited", updated_by: SEED.adminProfile })
      .eq("id", id)
      .select("id");

    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/^FORBIDDEN: updated_by must be the editing user$/);
    expect(await rowOf(id)).toEqual(ORIGINAL);
  });
});

/**
 * Migration 20261007090005: trg_attachments_daily_update and
 * trg_daily_updates_photos. A daily update's photo must be added by an
 * admin/site user, in the update's project; on a posted update only by its
 * author (and not on a deleted one); on a not-yet-posted (draft) id only if
 * no one else's photos are already there; and at most four, race-safe.
 * Other entity types are untouched.
 *
 * Like every file here these run only against a non-production database
 * (D49) — none exists today, so they are written but not yet run.
 */
describe("daily update photos — who may attach them, and at most four", () => {
  const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000c2";
  const SITE_EMAIL = "ravi@beapex.in";
  const CLIENT_EMAIL = "tvrao@example.invalid";

  function photoRow(entityId: string, over: Partial<Record<string, unknown>> = {}) {
    return {
      org_id: SEED.org,
      project_id: SEED.project,
      entity_type: "daily_update",
      entity_id: entityId,
      r2_key: `org/test/du-photo-${crypto.randomUUID()}.jpg`,
      file_name: "photo.jpg",
      mime_type: "image/jpeg",
      size_bytes: 100,
      uploaded_by: SEED.siteProfile,
      ...over,
    };
  }

  /** Inserts a photo row as a signed-in user — through RLS and the trigger. */
  async function attachAs(as: SupabaseClient, entityId: string, over: Partial<Record<string, unknown>> = {}) {
    const result = await as.from("attachments").insert(photoRow(entityId, over)).select("id").single();
    if (result.data) cleanupAttachmentIds.push((result.data as { id: string }).id);
    return result;
  }

  /** Inserts a photo row on the privileged connection — setup, or the trigger alone. */
  async function attachDirect(entityId: string, over: Partial<Record<string, unknown>> = {}) {
    const r = photoRow(entityId, over);
    const row = one(
      await sql`insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by, deleted_at)
                values (${r.org_id as string}, ${r.project_id as string | null}, ${r.entity_type as string}, ${entityId}, ${r.r2_key as string}, 'photo.jpg', 'image/jpeg', 100, ${r.uploaded_by as string}, ${(over.deleted_at as string | undefined) ?? null})
                returning id`,
      "inserted a photo row"
    );
    cleanupAttachmentIds.push(row.id);
    return row.id as string;
  }

  async function postedUpdate(author: string = SEED.siteProfile, deleted = false): Promise<string> {
    const update = one(
      await sql`insert into public.daily_updates (org_id, project_id, package_id, update_date, body, author_id, deleted_at)
                values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, current_date, 'photo test', ${author}, ${deleted ? sql`now()` : null})
                returning id`,
      "inserted an update"
    );
    cleanupUpdateIds.push(update.id);
    return update.id;
  }

  async function livePhotos(entityId: string): Promise<number> {
    const row = one(
      await sql`select count(*)::int as n from public.attachments
                 where entity_type = 'daily_update' and entity_id = ${entityId} and deleted_at is null`,
      "photo count"
    );
    return row.n;
  }

  it("accepts the author's photo on their own posted update", async () => {
    const updateId = await postedUpdate();
    const site = await signedInAs(SITE_EMAIL);

    const { error } = await attachAs(site, updateId);

    expect(error).toBeNull();
    expect(await livePhotos(updateId)).toBe(1);
  });

  it("accepts a photo on a draft id — the web uploads photos before posting", async () => {
    const draftId = crypto.randomUUID();
    const site = await signedInAs(SITE_EMAIL);

    const { error } = await attachAs(site, draftId);

    expect(error).toBeNull();
    expect(await livePhotos(draftId)).toBe(1);
  });

  it("refuses a client's photo on a daily update (FORBIDDEN)", async () => {
    const draftId = crypto.randomUUID();
    const client = await signedInAs(CLIENT_EMAIL);

    const { error } = await attachAs(client, draftId, { uploaded_by: SEED.clientProfile });

    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/^FORBIDDEN: only admin or site may add photos to a daily update$/);
    expect(await livePhotos(draftId)).toBe(0);
  });

  it("refuses a photo on another user's posted update (FORBIDDEN)", async () => {
    const updateId = await postedUpdate(SEED.adminProfile);
    const site = await signedInAs(SITE_EMAIL);

    const { error } = await attachAs(site, updateId);

    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/^FORBIDDEN: only the author can add photos to a daily update$/);
    expect(await livePhotos(updateId)).toBe(0);
  });

  it("refuses a photo filed under another project than the update's (NOT_FOUND)", async () => {
    // Privileged connection: RLS would refuse a non-member's project first,
    // so this proves the trigger itself compares the two projects.
    const updateId = await postedUpdate();

    await expect(attachDirect(updateId, { project_id: OTHER_PROJECT })).rejects.toThrow(
      /NOT_FOUND: daily update .* does not exist in this project/
    );
    expect(await livePhotos(updateId)).toBe(0);
  });

  it("refuses a photo on a deleted update (NOT_FOUND)", async () => {
    const updateId = await postedUpdate(SEED.siteProfile, true);
    const site = await signedInAs(SITE_EMAIL);

    const { error } = await attachAs(site, updateId);

    expect(error?.code).toBe("P0002");
    expect(await livePhotos(updateId)).toBe(0);
  });

  it("refuses a photo on another user's draft id (FORBIDDEN)", async () => {
    const draftId = crypto.randomUUID();
    await attachDirect(draftId, { uploaded_by: SEED.adminProfile });
    const site = await signedInAs(SITE_EMAIL);

    const { error } = await attachAs(site, draftId);

    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/^FORBIDDEN: those photos belong to another daily update$/);
    expect(await livePhotos(draftId)).toBe(1);
  });

  it("refuses posting an update onto an id carrying someone else's photos (FORBIDDEN)", async () => {
    const draftId = crypto.randomUUID();
    await attachDirect(draftId, { uploaded_by: SEED.adminProfile });
    const site = await signedInAs(SITE_EMAIL);

    const { error } = await site.from("daily_updates").insert({
      id: draftId,
      org_id: SEED.org,
      project_id: SEED.project,
      package_id: SEED.poolPackage,
      update_date: "2026-10-07",
      body: "posted over someone else's photos",
      author_id: SEED.siteProfile,
    });
    cleanupUpdateIds.push(draftId);

    expect(error?.code).toBe("42501");
    const posted = await sql`select id from public.daily_updates where id = ${draftId}`;
    expect(posted.length).toBe(0);
  });

  it("still lets the author post the update their own draft photos were uploaded for", async () => {
    const draftId = crypto.randomUUID();
    const site = await signedInAs(SITE_EMAIL);
    await attachAs(site, draftId);

    const { error } = await site.from("daily_updates").insert({
      id: draftId,
      org_id: SEED.org,
      project_id: SEED.project,
      package_id: SEED.poolPackage,
      update_date: "2026-10-07",
      body: "posted with my photo",
      author_id: SEED.siteProfile,
    });
    cleanupUpdateIds.push(draftId);

    expect(error).toBeNull();
  });

  it("accepts the first through fourth photo, refuses a fifth, and leaves the four untouched", async () => {
    const updateId = await postedUpdate();
    const site = await signedInAs(SITE_EMAIL);

    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { data, error } = await attachAs(site, updateId);
      expect(error).toBeNull();
      ids.push((data as { id: string }).id);
    }
    const fifth = await attachAs(site, updateId);

    expect(fifth.error?.code).toBe("23514");
    expect(fifth.error?.message).toMatch(/^REASON_REQUIRED: this daily_update already has 4 attachments$/);
    const rows = await sql`select id from public.attachments
                            where entity_type = 'daily_update' and entity_id = ${updateId} and deleted_at is null
                            order by created_at`;
    expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  it("does not count a deleted photo, nor limit other entity types", async () => {
    const draftId = crypto.randomUUID();
    await attachDirect(draftId, { deleted_at: new Date().toISOString() });
    for (let i = 0; i < 4; i++) await attachDirect(draftId);
    expect(await livePhotos(draftId)).toBe(4);

    // Five 'project' rows on one id: the daily-update rule never applies.
    const otherId = crypto.randomUUID();
    for (let i = 0; i < 5; i++) await attachDirect(otherId, { entity_type: "project" });
    const others = one(
      await sql`select count(*)::int as n from public.attachments where entity_type = 'project' and entity_id = ${otherId}`,
      "project attachments"
    );
    expect(others.n).toBe(5);
  });

  it("never lets concurrent confirms exceed four", async () => {
    // Six transactions, each inserting one photo for the same draft id and
    // holding it uncommitted for a moment — without the advisory lock every
    // one would count zero and all six would land.
    const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error("SUPABASE_DB_URL is not set");
    const racers = postgres(url, { max: 6, prepare: false, onnotice: () => {} });
    const draftId = crypto.randomUUID();
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          racers.begin(async (tx) => {
            const r = photoRow(draftId);
            const [row] =
              await tx`insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by)
                                   values (${SEED.org}, ${SEED.project}, 'daily_update', ${draftId}, ${r.r2_key as string}, 'photo.jpg', 'image/jpeg', 100, ${SEED.siteProfile})
                                   returning id`;
            await tx`select pg_sleep(0.3)`;
            return row?.id as string;
          })
        )
      );
      for (const r of results) if (r.status === "fulfilled") cleanupAttachmentIds.push(r.value);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
      const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(refused).toHaveLength(2);
      for (const r of refused)
        expect(String(r.reason)).toMatch(/REASON_REQUIRED: this daily_update already has 4/);
      expect(await livePhotos(draftId)).toBe(4);
    } finally {
      await racers.end({ timeout: 5 });
    }
  });
});
