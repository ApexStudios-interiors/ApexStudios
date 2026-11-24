import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { connect, SEED } from "./db";

/**
 * build/07-stock-inventory-notifications.md §2.6, D33 (docs/decisions.md).
 *
 * AGENTS.md database rule 8: tested from real client-SDK sessions, never a
 * privileged connection — that is exactly the class of bug this file exists
 * to catch. `v_notifications`'s `bill_submitted` branch read `public.bills`
 * directly and relied on RLS to scope it correctly; `bills` has no select
 * policy for Client at all, so a Client session got silently filtered to zero
 * rows before `for_roles` was ever consulted (D33). A service_role or SQL
 * editor check would never have noticed, because both bypass RLS entirely.
 */

const PASSWORD = "apex-dev-only";
const CLIENT_EMAIL = "tvrao@example.invalid";
const SITE_EMAIL = "ravi@beapex.in";
const ADMIN_EMAIL = "suresh@beapex.in";

function anonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set for this suite.");
  }
  return createClient(url, key);
}

async function signedInAs(email: string): Promise<SupabaseClient> {
  const supabase = anonClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return supabase;
}

const openClients: SupabaseClient[] = [];
async function client(email: string) {
  const c = await signedInAs(email);
  openClients.push(c);
  return c;
}
afterAll(async () => {
  await Promise.all(openClients.map((c) => c.auth.signOut()));
});

type NotifRow = { kind: string; project_id: string | null; title: string };

/**
 * Mirrors `features/notifications/queries.ts`'s own `.contains("for_roles",
 * [role])` filter — `for_roles` is a display concern the app applies on top
 * of the view, not something RLS enforces on `v_notifications` itself (the
 * view is `security_invoker = on`; whether a row is even visible at all is
 * each underlying table's own policy, `for_roles` is just a column on it).
 * Querying the raw view without this filter would conflate the two and
 * report a false failure for Site, who does have a real `project_members`
 * row on the seeded project and can legitimately see the submitted bills
 * through `v_bill_client` — just not tagged as their concern.
 */
async function notificationsFor(email: string, role: string): Promise<NotifRow[]> {
  const supabase = await client(email);
  const { data, error } = await supabase
    .from("v_notifications")
    .select("kind, project_id, title")
    .eq("project_id", SEED.project)
    .contains("for_roles", [role]);
  expect(error).toBeNull();
  return (data ?? []) as NotifRow[];
}

describe("v_notifications — Client role", () => {
  it("sees bill_submitted (D33: was silently 0 rows before the fix)", async () => {
    const rows = await notificationsFor(CLIENT_EMAIL, "client");
    const billRows = rows.filter((r) => r.kind === "bill_submitted");
    expect(billRows.length).toBeGreaterThan(0);
  });

  it("still cannot read public.bills directly — the fix widens v_notifications, not RLS itself", async () => {
    const supabase = await client(CLIENT_EMAIL);
    const { data, error } = await supabase.from("bills").select("id").eq("project_id", SEED.project);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("does not see stock_request or inventory_low (not this role's job)", async () => {
    const rows = await notificationsFor(CLIENT_EMAIL, "client");
    expect(rows.some((r) => r.kind === "stock_request")).toBe(false);
    expect(rows.some((r) => r.kind === "inventory_low")).toBe(false);
  });
});

describe("v_notifications — Site role", () => {
  it("sees stock_request and inventory_low, never bill_submitted or approval_pending", async () => {
    const rows = await notificationsFor(SITE_EMAIL, "site");
    // D35: asserted individually, not `a || b` — the OR let stock_request
    // being silently empty (v_notifications read public.stock_requests
    // directly; Site has no select policy on that table at all) hide behind
    // inventory_low alone passing. Caught live via Playwright, not here,
    // which is the whole reason this is two assertions now, not one.
    expect(rows.some((r) => r.kind === "stock_request")).toBe(true);
    expect(rows.some((r) => r.kind === "inventory_low")).toBe(true);
    expect(rows.some((r) => r.kind === "bill_submitted")).toBe(false);
    expect(rows.some((r) => r.kind === "approval_pending")).toBe(false);
  });
});

describe("v_notifications — Admin role (control case)", () => {
  it("sees both stock_request and bill_submitted for a project it has no membership row on", async () => {
    const rows = await notificationsFor(ADMIN_EMAIL, "admin");
    expect(rows.some((r) => r.kind === "stock_request")).toBe(true);
    expect(rows.some((r) => r.kind === "bill_submitted")).toBe(true);
  });
});

/**
 * D72 (2026-11-24): status-change and inbox rows, through the SAME audience
 * filter the app uses (features/notifications/service.ts audienceFilter) —
 * the role's rows, or rows naming this person. Fixtures are written over the
 * privileged connection and removed afterwards; the reads are real sessions.
 */
describe("v_notifications — status changes and the inbox (D72)", () => {
  const sql = connect();
  const APPROVED_ID = "00000000-0000-4000-8000-00000a1810a1";
  const SITE_ID = SEED.siteProfile;

  beforeAll(async () => {
    await sql`
      insert into public.stock_requests
        (id, org_id, project_id, package_id, ref_no, material_name, qty, unit, status, requested_by,
         approved_by, approved_at, created_at)
      values (${APPROVED_ID}, ${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, 'SR-ITEST-D72',
              'Itest approved grout', 1, 'bag', 'approved', ${SITE_ID}, ${SEED.adminProfile},
              now() - interval '1 hour', now() - interval '2 hours')
      on conflict (id) do nothing`;
  });
  afterAll(async () => {
    await sql`delete from public.stock_requests where id = ${APPROVED_ID}`;
    await sql.end({ timeout: 5 });
  });

  async function audienceRows(email: string, role: string, profileId: string) {
    const supabase = await client(email);
    const { data, error } = await supabase
      .from("v_notifications")
      .select("kind, entity_id, title")
      .eq("project_id", SEED.project)
      .or(`for_roles.cs.{${role}},for_profile_id.eq.${profileId}`);
    expect(error).toBeNull();
    return (data ?? []) as { kind: string; entity_id: string; title: string }[];
  }

  it("site: the requester is told their request was approved", async () => {
    const rows = await audienceRows(SITE_EMAIL, "site", SITE_ID);
    expect(rows.some((r) => r.kind === "stock_approved" && r.entity_id === APPROVED_ID)).toBe(true);
  });

  it("admin: is not told about someone else's approved request", async () => {
    const rows = await audienceRows(ADMIN_EMAIL, "admin", SEED.adminProfile);
    expect(rows.some((r) => r.kind === "stock_approved" && r.entity_id === APPROVED_ID)).toBe(false);
  });

  it("admin: the seeded rejected approval (never superseded) waits for a revision", async () => {
    const rows = await audienceRows(ADMIN_EMAIL, "admin", SEED.adminProfile);
    expect(rows.some((r) => r.kind === "approval_revision")).toBe(true);
  });

  it("client: no stock row of any kind, even reading the raw view for every role", async () => {
    const supabase = await client(CLIENT_EMAIL);
    const { data, error } = await supabase
      .from("v_notifications")
      .select("kind")
      .in("kind", ["stock_approved", "stock_ordered", "stock_delivered", "stock_rejected", "delivery_due"]);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const notify = await supabase.from("v_stock_request_notify").select("id");
    expect(notify.error).toBeNull();
    expect(notify.data).toEqual([]);
  });

  it("site: no admin-only bill row, even reading the raw view", async () => {
    const supabase = await client(SITE_EMAIL);
    const { data, error } = await supabase
      .from("v_notifications")
      .select("kind")
      .in("kind", ["bill_certified", "bill_rejected", "bill_draft", "bill_unpaid"]);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("v_notifications — anon", () => {
  it("gets zero rows — this project's table grants are broad by platform default, RLS is the actual boundary", async () => {
    const supabase = anonClient();
    const { data, error } = await supabase
      .from("v_notifications")
      .select("kind")
      .eq("project_id", SEED.project);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
