import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { connect, SEED } from "./db";
import { one } from "./expect-row";

/**
 * build/08-approvals.md. AGENTS.md's own testing table: "New RPC → Integration
 * test including the illegal-transition and concurrency cases," plus "New
 * role-visible surface → pgTAP assertion that the forbidden columns are
 * absent" (that half lives in `supabase/tests/09_approvals_test.sql`; the
 * behavioural half — FORBIDDEN, ILLEGAL_TRANSITION, RLS on `attachments` —
 * belongs here, tested from real client-SDK sessions (AGENTS.md database
 * rule 8), never the privileged `sql` connection or the SQL editor.
 *
 * 02-lld.md §6.3 test 6: "admin calling rpc_decide_approval must FORBIDDEN."
 */

const PASSWORD = "apex-dev-only";
const SITE_EMAIL = "ravi@beapex.in";
const ADMIN_EMAIL = "suresh@beapex.in";
const OWNER_EMAIL = "hello@beapex.in";
const CLIENT_EMAIL = "tvrao@example.invalid";

function anonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.");
  return createClient(url, key);
}

async function signedInAs(email: string): Promise<SupabaseClient> {
  const supabase = anonClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return supabase;
}

const sql = connect();
const openClients: SupabaseClient[] = [];
async function client(email: string) {
  const c = await signedInAs(email);
  openClients.push(c);
  return c;
}

const trackedApprovalIds: string[] = [];
afterEach(async () => {
  if (trackedApprovalIds.length) {
    await sql`delete from public.attachments where entity_type = 'approval' and entity_id = any(${trackedApprovalIds})`;
    await sql`delete from public.approvals where id = any(${trackedApprovalIds})`;
    trackedApprovalIds.length = 0;
  }
});
afterAll(async () => {
  await Promise.all(openClients.map((c) => c.auth.signOut()));
  await sql.end({ timeout: 5 });
});

type ApprovalRow = {
  id: string;
  ref_no: string;
  project_id: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
};

/** Through the real RPC, not a direct insert — `ref_no` is server-assigned
 *  and the row-lock/sequence behaviour is exactly what this file wants to
 *  exercise, same reason `rpc_create_stock_request` gets called directly
 *  rather than faked with SQL in the sibling suite. */
async function createApproval(
  as: SupabaseClient,
  overrides: { item?: string; supersedesId?: string } = {}
): Promise<ApprovalRow> {
  const id = randomUUID();
  const { data, error } = await as.rpc("rpc_create_approval", {
    p_id: id,
    p_project_id: SEED.project,
    p_package_id: SEED.poolPackage,
    p_type: "material_sample",
    p_item: overrides.item ?? "Integration test approval",
    p_supersedes_id: overrides.supersedesId,
  });
  if (error) throw new Error(`rpc_create_approval failed: ${error.message}`);
  const row = data as ApprovalRow;
  trackedApprovalIds.push(row.id);
  return row;
}

describe("rpc_decide_approval — client sign-off", () => {
  it("approving stamps decided_by, decided_at and status", async () => {
    const site = await client(SITE_EMAIL);
    const approval = await createApproval(site);

    const clientSession = await client(CLIENT_EMAIL);
    const { data, error } = await clientSession.rpc("rpc_decide_approval", {
      p_approval_id: approval.id,
      p_decision: "approved",
    });
    expect(error).toBeNull();
    const row = data as ApprovalRow;
    expect(row.status).toBe("approved");
    expect(row.decided_by).toBe(SEED.clientProfile);
    expect(row.decided_at).not.toBeNull();
  });

  it("deciding an already-decided approval raises ILLEGAL_TRANSITION", async () => {
    const site = await client(SITE_EMAIL);
    const approval = await createApproval(site);
    const clientSession = await client(CLIENT_EMAIL);

    const first = await clientSession.rpc("rpc_decide_approval", {
      p_approval_id: approval.id,
      p_decision: "approved",
    });
    expect(first.error).toBeNull();

    const second = await clientSession.rpc("rpc_decide_approval", {
      p_approval_id: approval.id,
      p_decision: "rejected",
      p_reason: "too late",
    });
    expect(second.error?.message).toMatch(/ILLEGAL_TRANSITION/);
  });

  it("rejecting with an empty reason raises REASON_REQUIRED", async () => {
    const site = await client(SITE_EMAIL);
    const approval = await createApproval(site);
    const clientSession = await client(CLIENT_EMAIL);

    const { error } = await clientSession.rpc("rpc_decide_approval", {
      p_approval_id: approval.id,
      p_decision: "rejected",
    });
    expect(error?.message).toMatch(/REASON_REQUIRED/);

    const rows = await sql`select status from public.approvals where id = ${approval.id}`;
    expect(one(rows, "approval after refused rejection").status).toBe("pending");
  });

  it("rejecting with a reason succeeds", async () => {
    const site = await client(SITE_EMAIL);
    const approval = await createApproval(site);
    const clientSession = await client(CLIENT_EMAIL);

    const { data, error } = await clientSession.rpc("rpc_decide_approval", {
      p_approval_id: approval.id,
      p_decision: "rejected",
      p_reason: "Wrong shade, please resubmit",
    });
    expect(error).toBeNull();
    expect((data as ApprovalRow).status).toBe("rejected");
  });

  // 02-lld.md §6.3 test 6, verbatim: "admin calling rpc_decide_approval must
  // FORBIDDEN." 01-hld.md §7.1's own "deliberate negative" — no admin bypass,
  // including for testing (AGENTS.md's billing-rules section says the same
  // of certifyBill).
  it("admin is FORBIDDEN from deciding, even on a project they administer", async () => {
    const site = await client(SITE_EMAIL);
    const approval = await createApproval(site);
    const admin = await client(ADMIN_EMAIL);

    const { error } = await admin.rpc("rpc_decide_approval", {
      p_approval_id: approval.id,
      p_decision: "approved",
    });
    expect(error?.message).toMatch(/FORBIDDEN/);
  });

  it("owner is FORBIDDEN from deciding too — not just admin", async () => {
    const site = await client(SITE_EMAIL);
    const approval = await createApproval(site);
    const owner = await client(OWNER_EMAIL);

    const { error } = await owner.rpc("rpc_decide_approval", {
      p_approval_id: approval.id,
      p_decision: "approved",
    });
    expect(error?.message).toMatch(/FORBIDDEN/);
  });

  it("site is FORBIDDEN from deciding its own request", async () => {
    const site = await client(SITE_EMAIL);
    const approval = await createApproval(site);

    const { error } = await site.rpc("rpc_decide_approval", {
      p_approval_id: approval.id,
      p_decision: "approved",
    });
    expect(error?.message).toMatch(/FORBIDDEN/);
  });
});

describe("rpc_decide_approval — membership", () => {
  it("a client with no membership on the project is refused", async () => {
    const project = one(
      await sql`insert into public.projects (org_id, client_id, code, name, start_date)
                values (${SEED.org}, (select client_id from public.projects where id = ${SEED.project}),
                        'AP-TEST-NOMEMBER', 'Approvals non-member fixture', current_date)
                returning id`,
      "fixture project"
    );
    const pkg = one(
      await sql`insert into public.packages (org_id, project_id, seq_no, name)
                values (${SEED.org}, ${project.id}, 1, 'Fixture package')
                returning id`,
      "fixture package"
    );
    const approval = one(
      await sql`insert into public.approvals (org_id, project_id, package_id, ref_no, type, item, status, requested_by, created_by)
                values (${SEED.org}, ${project.id}, ${pkg.id}, 'AP-TEST-NOMEMBER-001', 'material_sample',
                        'Non-member fixture approval', 'pending', ${SEED.siteProfile}, ${SEED.siteProfile})
                returning id`,
      "fixture approval"
    );

    const clientSession = await client(CLIENT_EMAIL);
    const { error } = await clientSession.rpc("rpc_decide_approval", {
      p_approval_id: approval.id,
      p_decision: "approved",
    });
    expect(error?.message).toMatch(/FORBIDDEN/);

    await sql`delete from public.approvals where id = ${approval.id}`;
    await sql`delete from public.packages where id = ${pkg.id}`;
    await sql`delete from public.projects where id = ${project.id}`;
  });
});

describe("approvals — visible to all three roles (01-hld.md §7.1)", () => {
  it("admin, site and client can all read a project's approvals", async () => {
    const site = await client(SITE_EMAIL);
    const approval = await createApproval(site);

    for (const email of [ADMIN_EMAIL, SITE_EMAIL, CLIENT_EMAIL]) {
      const session = await client(email);
      const { data, error } = await session
        .from("approvals")
        .select("id")
        .eq("id", approval.id)
        .maybeSingle();
      expect(error, `${email} should be able to read the approval`).toBeNull();
      expect(data, `${email} should see the row it is a member of the project for`).not.toBeNull();
    }
  });
});

describe("ap_decided_ck — the invariant, not just the constraint's existence", () => {
  it("a pending row with a decided_at is refused at the database", async () => {
    await expect(
      sql`insert into public.approvals (org_id, project_id, package_id, ref_no, type, item, status, decided_at, requested_by, created_by)
          values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, 'AP-TEST-CK-001', 'material_sample',
                  'Invariant test', 'pending', now(), ${SEED.siteProfile}, ${SEED.siteProfile})`
    ).rejects.toThrow(/ap_decided_ck/);
  });

  it("an approved row with no decided_at is refused at the database", async () => {
    await expect(
      sql`insert into public.approvals (org_id, project_id, package_id, ref_no, type, item, status, requested_by, created_by)
          values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, 'AP-TEST-CK-002', 'material_sample',
                  'Invariant test', 'approved', ${SEED.siteProfile}, ${SEED.siteProfile})`
    ).rejects.toThrow(/ap_decided_ck/);
  });
});

describe("supersession — links both directions (01-hld.md §8.2)", () => {
  it("a revised approval and the one it replaces link to each other", async () => {
    const site = await client(SITE_EMAIL);
    const original = await createApproval(site, { item: "Original sample" });

    const clientSession = await client(CLIENT_EMAIL);
    const { error: rejectErr } = await clientSession.rpc("rpc_decide_approval", {
      p_approval_id: original.id,
      p_decision: "rejected",
      p_reason: "Wrong finish",
    });
    expect(rejectErr).toBeNull();

    const revised = await createApproval(site, { item: "Revised sample", supersedesId: original.id });

    const rows =
      await sql`select id, supersedes_id from public.approvals where id = ${original.id} or id = ${revised.id}`;
    const revisedRow = rows.find((r) => r.id === revised.id);
    const originalRow = rows.find((r) => r.id === original.id);
    expect(revisedRow?.supersedes_id).toBe(original.id);

    // The backward link (what superseded THIS row) has no column of its
    // own — it is the reverse of another row's supersedes_id.
    const backLink = await sql`select id from public.approvals where supersedes_id = ${originalRow?.id}`;
    expect(one(backLink, "row superseding the original").id).toBe(revised.id);
  });

  it("superseding a still-pending approval is refused — only rejected may be superseded", async () => {
    const site = await client(SITE_EMAIL);
    const pending = await createApproval(site, { item: "Still pending" });

    const id = randomUUID();
    const { error } = await site.rpc("rpc_create_approval", {
      p_id: id,
      p_project_id: SEED.project,
      p_package_id: SEED.poolPackage,
      p_type: "material_sample",
      p_item: "Attempted revision",
      p_supersedes_id: pending.id,
    });
    expect(error?.message).toMatch(/ILLEGAL_TRANSITION/);
  });
});

describe("rpc_create_approval — concurrency", () => {
  it("two concurrent creates on the same project produce distinct ref_no values", async () => {
    const siteA = await client(SITE_EMAIL);
    const siteB = await signedInAs(SITE_EMAIL);
    openClients.push(siteB);

    const idA = randomUUID();
    const idB = randomUUID();
    const [ra, rb] = await Promise.all([
      siteA.rpc("rpc_create_approval", {
        p_id: idA,
        p_project_id: SEED.project,
        p_package_id: SEED.poolPackage,
        p_type: "material_sample",
        p_item: "Concurrency test A",
      }),
      siteB.rpc("rpc_create_approval", {
        p_id: idB,
        p_project_id: SEED.project,
        p_package_id: SEED.poolPackage,
        p_type: "material_sample",
        p_item: "Concurrency test B",
      }),
    ]);
    expect(ra.error).toBeNull();
    expect(rb.error).toBeNull();
    const rowA = ra.data as ApprovalRow;
    const rowB = rb.data as ApprovalRow;
    trackedApprovalIds.push(rowA.id, rowB.id);
    expect(rowA.ref_no).not.toBe(rowB.ref_no);
  });

  // Pre-merge review found this: the superseded row's status was read
  // without a lock, so two concurrent supersession creates against the same
  // rejected approval could both succeed, silently dropping one of the two
  // forward links. Fixed in migration 0038 (`for update` plus an
  // already-superseded check evaluated after the lock is held).
  it("two concurrent supersessions of the same rejected approval — exactly one succeeds", async () => {
    const site = await client(SITE_EMAIL);
    const original = await createApproval(site, { item: "Race test original" });

    const clientSession = await client(CLIENT_EMAIL);
    const { error: rejectErr } = await clientSession.rpc("rpc_decide_approval", {
      p_approval_id: original.id,
      p_decision: "rejected",
      p_reason: "test",
    });
    expect(rejectErr).toBeNull();

    const siteB = await signedInAs(SITE_EMAIL);
    openClients.push(siteB);
    const idA = randomUUID();
    const idB = randomUUID();
    const [ra, rb] = await Promise.all([
      site.rpc("rpc_create_approval", {
        p_id: idA,
        p_project_id: SEED.project,
        p_package_id: SEED.poolPackage,
        p_type: "material_sample",
        p_item: "Race test revision A",
        p_supersedes_id: original.id,
      }),
      siteB.rpc("rpc_create_approval", {
        p_id: idB,
        p_project_id: SEED.project,
        p_package_id: SEED.poolPackage,
        p_type: "material_sample",
        p_item: "Race test revision B",
        p_supersedes_id: original.id,
      }),
    ]);
    const results = [ra, rb];
    const succeeded = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0]?.error?.message).toMatch(/ILLEGAL_TRANSITION/);

    for (const r of succeeded) trackedApprovalIds.push((r.data as ApprovalRow).id);

    const backLink = await sql`select id from public.approvals where supersedes_id = ${original.id}`;
    expect(backLink.length).toBe(1);
  });
});

describe("attachments freeze on decision (migrations 0036/0037)", () => {
  it("a photo can be added while pending, and is refused once decided", async () => {
    const site = await client(SITE_EMAIL);
    const approval = await createApproval(site);

    const pendingInsert = await site
      .from("attachments")
      .insert({
        org_id: SEED.org,
        project_id: SEED.project,
        entity_type: "approval",
        entity_id: approval.id,
        uploaded_by: SEED.siteProfile,
        mime_type: "image/jpeg",
        size_bytes: 1000,
        file_name: "sample.jpg",
        r2_key: `test/${approval.id}/sample.jpg`,
      })
      .select("id")
      .single();
    expect(pendingInsert.error).toBeNull();
    const attachmentId = (pendingInsert.data as { id: string }).id;

    const clientSession = await client(CLIENT_EMAIL);
    const { error: decideErr } = await clientSession.rpc("rpc_decide_approval", {
      p_approval_id: approval.id,
      p_decision: "approved",
    });
    expect(decideErr).toBeNull();

    // addSamplePhotos' own action-layer guard refuses a decided approval
    // before ever attempting this (features/approvals/service.ts's
    // `canAddPhotos`, unit-tested) — this is the RLS half, "the layer that
    // holds when the action layer is wrong."
    const postDecideInsert = await site
      .from("attachments")
      .insert({
        org_id: SEED.org,
        project_id: SEED.project,
        entity_type: "approval",
        entity_id: approval.id,
        uploaded_by: SEED.siteProfile,
        mime_type: "image/jpeg",
        size_bytes: 1000,
        file_name: "sample2.jpg",
        r2_key: `test/${approval.id}/sample2.jpg`,
      })
      .select("id")
      .single();
    expect(postDecideInsert.error).not.toBeNull();

    // 02-lld.md §6.1's own 24-hour uploader self-delete window does not
    // override the freeze — deleting an attachment on a decided approval is
    // refused even by its own uploader, even within the window.
    const del = await site.from("attachments").delete().eq("id", attachmentId).select("id");
    expect(del.data ?? []).toHaveLength(0);

    await sql`delete from public.attachments where id = ${attachmentId}`;
  });

  it("a photo can be uploaded BEFORE the approval row exists (the create-flow path)", async () => {
    const site = await client(SITE_EMAIL);
    const approvalId = randomUUID();

    const insert = await site
      .from("attachments")
      .insert({
        org_id: SEED.org,
        project_id: SEED.project,
        entity_type: "approval",
        entity_id: approvalId,
        uploaded_by: SEED.siteProfile,
        mime_type: "image/jpeg",
        size_bytes: 1000,
        file_name: "presubmit.jpg",
        r2_key: `test/${approvalId}/presubmit.jpg`,
      })
      .select("id")
      .single();
    // Regression guard for the 0036 bug (fixed in 0037): the freeze
    // predicate must not require a PENDING row to already exist — no row at
    // all is not "decided" and must not be treated as if it were.
    expect(insert.error).toBeNull();

    const { error: createErr } = await site.rpc("rpc_create_approval", {
      p_id: approvalId,
      p_project_id: SEED.project,
      p_package_id: SEED.poolPackage,
      p_type: "material_sample",
      p_item: "Create-flow attachment test",
    });
    expect(createErr).toBeNull();
    trackedApprovalIds.push(approvalId);
  });
});
