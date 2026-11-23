import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { connect, SEED } from "./db";
import { one } from "./expect-row";

/**
 * Migrations 20261124400001 / 20261124400002 — the audited stock and
 * inventory fixes (APX-03, 14, 15, 34, 42, 44, 69). AGENTS.md's testing
 * table: every new or changed RPC gets its illegal-transition and concurrency
 * cases, from real client-SDK sessions (database rule 8). Fixtures are written
 * on the privileged connection and swept up after each test.
 */

const PASSWORD = "apex-dev-only";
const SITE_EMAIL = "ravi@beapex.in";
const ADMIN_EMAIL = "suresh@beapex.in";
const CLIENT_EMAIL = "tvrao@example.invalid";
const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000c2";

function anonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.");
  return createClient(url, key);
}

const sql = connect();
const openClients: SupabaseClient[] = [];
async function client(email: string): Promise<SupabaseClient> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  openClients.push(c);
  return c;
}

const trackedRequestIds: string[] = [];
const trackedItemIds: string[] = [];
const trackedApprovalIds: string[] = [];
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

afterEach(async () => {
  if (trackedRequestIds.length) {
    // Remainders of a part delivery point back at a tracked request.
    const children = await sql`select id from public.stock_requests where split_from_id = any(${trackedRequestIds})`;
    const ids = [...trackedRequestIds, ...children.map((c) => c.id as string)];
    const items = await sql`select distinct inventory_item_id from public.stock_requests
                             where id = any(${ids}) and inventory_item_id is not null`;
    for (const i of items) if (!trackedItemIds.includes(i.inventory_item_id)) trackedItemIds.push(i.inventory_item_id);
    await sql`delete from public.stock_request_events where request_id = any(${ids})`;
    await sql`delete from public.stock_movements where ref_type = 'stock_request' and ref_id = any(${ids})`;
    await sql`update public.stock_requests set inventory_item_id = null, split_from_id = null where id = any(${ids})`;
    await sql`delete from public.stock_requests where id = any(${ids})`;
    trackedRequestIds.length = 0;
  }
  if (trackedItemIds.length) {
    await sql`delete from public.stock_movements where inventory_item_id = any(${trackedItemIds})`;
    await sql`delete from public.inventory_items where id = any(${trackedItemIds})`;
    trackedItemIds.length = 0;
  }
  if (trackedApprovalIds.length) {
    await sql`delete from public.approvals where id = any(${trackedApprovalIds})`;
    trackedApprovalIds.length = 0;
  }
});
afterAll(async () => {
  await Promise.all(openClients.map((c) => c.auth.signOut()));
  await sql.end({ timeout: 5 });
});

async function insertItem(qtyOnHand: number, opts: { name?: string; projectId?: string | null } = {}) {
  const rows = await sql`
    insert into public.inventory_items (org_id, project_id, name, unit, qty_on_hand, reorder_level, unit_cost, created_by)
    values (${SEED.org}, ${opts.projectId === undefined ? SEED.project : opts.projectId},
            ${opts.name ?? `Fixes test item ${tag()}`}, 'bag', ${qtyOnHand}, 0, 250, ${SEED.adminProfile})
    returning id`;
  const id = one(rows, "inserted item").id as string;
  trackedItemIds.push(id);
  if (qtyOnHand > 0) {
    await sql`insert into public.stock_movements (org_id, inventory_item_id, project_id, direction, qty, unit_cost, ref_type, reason, created_by)
              values (${SEED.org}, ${id}, ${opts.projectId === undefined ? SEED.project : opts.projectId}, 'in', ${qtyOnHand}, 250, 'adjustment', 'opening', ${SEED.adminProfile})`;
  }
  return id;
}

async function insertRequest(o: {
  status: "pending" | "approved" | "ordered" | "delivered";
  qty?: number;
  rate?: number | null;
  material?: string;
  requestedBy?: string;
}): Promise<string> {
  const rows = await sql`
    insert into public.stock_requests (
      org_id, project_id, package_id, ref_no, material_name, qty, unit, rate, status,
      requested_by, created_by, approved_by, approved_at, ordered_at, delivered_at
    ) values (
      ${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, ${"SR-FIX-" + tag()},
      ${o.material ?? "Fixes test material"}, ${o.qty ?? 10}, 'bag',
      ${o.rate === undefined ? 100 : o.rate}, ${o.status},
      ${o.requestedBy ?? SEED.siteProfile}, ${o.requestedBy ?? SEED.siteProfile},
      ${o.status === "pending" ? null : SEED.adminProfile},
      ${o.status === "pending" ? null : sql`now()`},
      ${o.status === "ordered" || o.status === "delivered" ? sql`now()` : null},
      ${o.status === "delivered" ? sql`now()` : null}
    ) returning id`;
  const id = one(rows, "inserted request").id as string;
  trackedRequestIds.push(id);
  return id;
}

const statusOf = async (id: string) =>
  one(await sql`select status::text as status from public.stock_requests where id = ${id}`, "request").status;
const qtyOf = async (id: string) =>
  Number(one(await sql`select qty_on_hand from public.inventory_items where id = ${id}`, "item").qty_on_hand);

// ── APX-03 ───────────────────────────────────────────────────────────────────
describe("APX-03 — a site session cannot read unit_cost", () => {
  it("is refused unit_cost on inventory_items, gets no stock_movements row, but still reads quantities", async () => {
    const site = await client(SITE_EMAIL);

    const cost = await site.from("inventory_items").select("name, unit_cost");
    expect(cost.error?.code).toBe("42501");
    expect(cost.data).toBeNull();

    const qty = await site.from("inventory_items").select("id, name, qty_on_hand, reorder_level");
    expect(qty.error).toBeNull();
    expect((qty.data ?? []).length).toBeGreaterThan(0);

    const moves = await site.from("stock_movements").select("qty, unit_cost");
    expect(moves.error).toBeNull();
    expect(moves.data).toEqual([]);

    const view = await site.from("v_inventory_site").select("id, name, qty_on_hand, stock_status, updated_at");
    expect(view.error).toBeNull();
    expect((view.data ?? []).length).toBeGreaterThan(0);

    const stats = await site.rpc("rpc_inventory_stats", { p_project_id: SEED.project });
    expect(stats.error).toBeNull();
    const row = one(stats.data as { total_items: number; total_value: number | null }[], "stats");
    expect(Number(row.total_items)).toBeGreaterThan(0);
    expect(row.total_value).toBeNull();
  });

  it("an admin reads unit_cost through v_inventory_status (the base column is withheld from every role)", async () => {
    const admin = await client(ADMIN_EMAIL);
    const { data, error } = await admin
      .from("v_inventory_status")
      .select("unit_cost, stock_value")
      .eq("id", SEED.cementItem);
    expect(error).toBeNull();
    expect(Number(one(data ?? [], "cement").unit_cost)).toBeGreaterThan(0);

    const base = await admin.from("inventory_items").select("unit_cost").eq("id", SEED.cementItem);
    expect(base.error?.code).toBe("42501");
  });

  it("the site bell still lists low stock (v_notifications reads the granted columns)", async () => {
    const site = await client(SITE_EMAIL);
    const { data, error } = await site.from("v_notifications").select("kind").eq("kind", "inventory_low");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("a client reads nothing from v_inventory_site", async () => {
    const c = await client(CLIENT_EMAIL);
    const { data, error } = await c.from("v_inventory_site").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

// ── APX-14 ───────────────────────────────────────────────────────────────────
describe("APX-14 — a rate on approval, and set until delivery", () => {
  it("approving a rate-less request without a rate is refused RATE_REQUIRED", async () => {
    const id = await insertRequest({ status: "pending", rate: null });
    const admin = await client(ADMIN_EMAIL);
    const { error } = await admin.rpc("rpc_transition_stock_request", {
      p_request_id: id,
      p_to_status: "approved",
    });
    expect(error?.message).toMatch(/^RATE_REQUIRED/);
    expect(await statusOf(id)).toBe("pending");
  });

  it("approving with a rate stores it, so committed and Billable Now are qty × rate", async () => {
    const id = await insertRequest({ status: "pending", rate: null, qty: 4 });
    const admin = await client(ADMIN_EMAIL);
    const before = one(
      await sql`select coalesce(committed, 0)::float as c from public.v_package_rollup where package_id = ${SEED.poolPackage}`,
      "rollup"
    ).c as number;

    const { error } = await admin.rpc("rpc_transition_stock_request", {
      p_request_id: id,
      p_to_status: "approved",
      p_rate: 250,
    });
    expect(error).toBeNull();
    const stored = one(await sql`select rate::float as rate from public.stock_requests where id = ${id}`, "r");
    expect(stored.rate).toBe(250);
    const after = one(
      await sql`select coalesce(committed, 0)::float as c from public.v_package_rollup where package_id = ${SEED.poolPackage}`,
      "rollup"
    ).c as number;
    expect(Math.round((after - before) * 100) / 100).toBe(1000);

    await admin.rpc("rpc_transition_stock_request", { p_request_id: id, p_to_status: "ordered" });
    await admin.rpc("rpc_transition_stock_request", { p_request_id: id, p_to_status: "delivered" });
    const billable = one(
      await sql`select internal_cost::float as cost from public.v_billable_now where source_id = ${id}`,
      "billable line"
    );
    expect(billable.cost).toBe(1000);
  });

  it("a rate given on any move other than approval is refused, and a site session may never give one", async () => {
    const ordered = await insertRequest({ status: "ordered" });
    const admin = await client(ADMIN_EMAIL);
    const onDeliver = await admin.rpc("rpc_transition_stock_request", {
      p_request_id: ordered,
      p_to_status: "delivered",
      p_rate: 1,
    });
    expect(onDeliver.error?.message).toMatch(/^ILLEGAL_TRANSITION/);

    const site = await client(SITE_EMAIL);
    const bySite = await site.rpc("rpc_transition_stock_request", {
      p_request_id: ordered,
      p_to_status: "delivered",
      p_rate: 1,
    });
    expect(bySite.error?.message).toMatch(/^FORBIDDEN/);
    expect(await statusOf(ordered)).toBe("ordered");
  });

  it("rpc_set_stock_request_rate: admin until delivery, audited; refused once delivered and for site", async () => {
    const ordered = await insertRequest({ status: "ordered", rate: null });
    const admin = await client(ADMIN_EMAIL);
    const ok = await admin.rpc("rpc_set_stock_request_rate", { p_request_id: ordered, p_rate: 410.5 });
    expect(ok.error).toBeNull();
    expect(Number((ok.data as { rate: number }).rate)).toBe(410.5);
    const audit = await sql`select action from public.audit_log where entity_type = 'stock_request' and entity_id = ${ordered}`;
    expect(audit.map((a) => a.action)).toContain("set_rate");

    const negative = await admin.rpc("rpc_set_stock_request_rate", { p_request_id: ordered, p_rate: -1 });
    expect(negative.error?.message).toMatch(/^RATE_REQUIRED/);

    const site = await client(SITE_EMAIL);
    const bySite = await site.rpc("rpc_set_stock_request_rate", { p_request_id: ordered, p_rate: 1 });
    expect(bySite.error?.message).toMatch(/^FORBIDDEN/);

    const delivered = await insertRequest({ status: "delivered" });
    const late = await admin.rpc("rpc_set_stock_request_rate", { p_request_id: delivered, p_rate: 1 });
    expect(late.error?.message).toMatch(/^ILLEGAL_TRANSITION/);
  });
});

// ── APX-15 ───────────────────────────────────────────────────────────────────
describe("APX-15 — deliveries of one material land on one item", () => {
  it("two deliveries of the same material (spelt differently) produce one item with the quantities summed", async () => {
    const name = `Cement OPC 53 ${tag()}`;
    const a = await insertRequest({ status: "ordered", material: name, qty: 5 });
    const b = await insertRequest({ status: "ordered", material: `  ${name.toUpperCase().replace(" ", "  ")} `, qty: 7 });
    const site = await client(SITE_EMAIL);

    expect((await site.rpc("rpc_transition_stock_request", { p_request_id: a, p_to_status: "delivered" })).error).toBeNull();
    expect((await site.rpc("rpc_transition_stock_request", { p_request_id: b, p_to_status: "delivered" })).error).toBeNull();

    const linked = await sql`select distinct inventory_item_id from public.stock_requests where id = any(${[a, b]})`;
    expect(linked).toHaveLength(1);
    expect(await qtyOf(linked[0]?.inventory_item_id)).toBe(12);
  });

  it("concurrent deliveries of two requests for a new material still create exactly one item", async () => {
    const name = `Concurrent sand ${tag()}`;
    const a = await insertRequest({ status: "ordered", material: name, qty: 2 });
    const b = await insertRequest({ status: "ordered", material: name, qty: 3 });
    const siteA = await client(SITE_EMAIL);
    const siteB = await client(SITE_EMAIL);

    const [ra, rb] = await Promise.all([
      siteA.rpc("rpc_transition_stock_request", { p_request_id: a, p_to_status: "delivered" }),
      siteB.rpc("rpc_transition_stock_request", { p_request_id: b, p_to_status: "delivered" }),
    ]);
    expect(ra.error).toBeNull();
    expect(rb.error).toBeNull();
    const items = await sql`select id, qty_on_hand from public.inventory_items
                             where project_id = ${SEED.project} and lower(name) = lower(${name}) and deleted_at is null`;
    expect(items).toHaveLength(1);
    expect(Number(items[0]?.qty_on_hand)).toBe(5);
  });

  it("the same name in a different unit is a different item", async () => {
    const name = `Unit split ${tag()}`;
    const a = await insertRequest({ status: "ordered", material: name });
    const b = await insertRequest({ status: "ordered", material: name });
    await sql`update public.stock_requests set unit = 'kit' where id = ${b}`;
    const admin = await client(ADMIN_EMAIL);
    await admin.rpc("rpc_transition_stock_request", { p_request_id: a, p_to_status: "delivered" });
    await admin.rpc("rpc_transition_stock_request", { p_request_id: b, p_to_status: "delivered" });
    const linked = await sql`select distinct inventory_item_id from public.stock_requests where id = any(${[a, b]})`;
    expect(linked).toHaveLength(2);
  });

  it("rpc_set_inventory_reorder_level: admin only, never negative, audited", async () => {
    const item = await insertItem(3);
    const admin = await client(ADMIN_EMAIL);
    const ok = await admin.rpc("rpc_set_inventory_reorder_level", { p_item_id: item, p_reorder_level: 10 });
    expect(ok.error).toBeNull();
    expect(Number((ok.data as { reorder_level: number }).reorder_level)).toBe(10);
    expect(JSON.stringify(ok.data)).not.toMatch(/unit_cost/);
    const audit = await sql`select action from public.audit_log where entity_type = 'inventory_item' and entity_id = ${item}`;
    expect(audit.map((a) => a.action)).toContain("set_reorder_level");

    const negative = await admin.rpc("rpc_set_inventory_reorder_level", { p_item_id: item, p_reorder_level: -1 });
    expect(negative.error?.message).toMatch(/^REASON_REQUIRED/);

    const site = await client(SITE_EMAIL);
    const bySite = await site.rpc("rpc_set_inventory_reorder_level", { p_item_id: item, p_reorder_level: 1 });
    expect(bySite.error?.message).toMatch(/^FORBIDDEN/);
  });
});

// ── APX-42 ───────────────────────────────────────────────────────────────────
describe("APX-42 — cancel and edit a stock request", () => {
  it("the requester cancels their own pending request; nobody else can", async () => {
    const id = await insertRequest({ status: "pending" });
    const admin = await client(ADMIN_EMAIL);
    const byAdmin = await admin.rpc("rpc_transition_stock_request", { p_request_id: id, p_to_status: "cancelled" });
    expect(byAdmin.error?.message).toMatch(/^FORBIDDEN/);

    const site = await client(SITE_EMAIL);
    const { error } = await site.rpc("rpc_transition_stock_request", { p_request_id: id, p_to_status: "cancelled" });
    expect(error).toBeNull();
    const row = one(
      await sql`select status::text as status, cancelled_at, cancelled_by from public.stock_requests where id = ${id}`,
      "cancelled"
    );
    expect(row.status).toBe("cancelled");
    expect(row.cancelled_at).not.toBeNull();
    expect(row.cancelled_by).toBe(SEED.siteProfile);
  });

  it("an admin cancels an approved or ordered request only with a reason; site cannot", async () => {
    const ordered = await insertRequest({ status: "ordered" });
    const site = await client(SITE_EMAIL);
    const bySite = await site.rpc("rpc_transition_stock_request", {
      p_request_id: ordered,
      p_to_status: "cancelled",
      p_note: "no longer needed",
    });
    expect(bySite.error?.message).toMatch(/^FORBIDDEN/);

    const admin = await client(ADMIN_EMAIL);
    const noReason = await admin.rpc("rpc_transition_stock_request", { p_request_id: ordered, p_to_status: "cancelled" });
    expect(noReason.error?.message).toMatch(/^REASON_REQUIRED/);

    const ok = await admin.rpc("rpc_transition_stock_request", {
      p_request_id: ordered,
      p_to_status: "cancelled",
      p_note: "Vendor withdrew",
    });
    expect(ok.error).toBeNull();
    const row = one(
      await sql`select cancelled_reason from public.stock_requests where id = ${ordered}`,
      "cancelled"
    );
    expect(row.cancelled_reason).toBe("Vendor withdrew");
  });

  it("cancelled is terminal, and a delivered request cannot be cancelled", async () => {
    const id = await insertRequest({ status: "pending" });
    const site = await client(SITE_EMAIL);
    await site.rpc("rpc_transition_stock_request", { p_request_id: id, p_to_status: "cancelled" });
    const admin = await client(ADMIN_EMAIL);
    const again = await admin.rpc("rpc_transition_stock_request", { p_request_id: id, p_to_status: "approved", p_rate: 1 });
    expect(again.error?.message).toMatch(/^ILLEGAL_TRANSITION/);

    const delivered = await insertRequest({ status: "delivered" });
    const late = await admin.rpc("rpc_transition_stock_request", {
      p_request_id: delivered,
      p_to_status: "cancelled",
      p_note: "too late",
    });
    expect(late.error?.message).toMatch(/^ILLEGAL_TRANSITION/);
  });

  it("concurrent cancel and deliver on one ordered request: exactly one wins, stock moves at most once", async () => {
    const item = await insertItem(0);
    const id = await insertRequest({ status: "ordered", qty: 4 });
    await sql`update public.stock_requests set inventory_item_id = ${item} where id = ${id}`;
    const admin = await client(ADMIN_EMAIL);
    const site = await client(SITE_EMAIL);

    const [cancel, deliver] = await Promise.all([
      admin.rpc("rpc_transition_stock_request", { p_request_id: id, p_to_status: "cancelled", p_note: "race" }),
      site.rpc("rpc_transition_stock_request", { p_request_id: id, p_to_status: "delivered" }),
    ]);
    expect([cancel.error, deliver.error].filter((e) => e === null)).toHaveLength(1);
    const status = await statusOf(id);
    expect(await qtyOf(item)).toBe(status === "delivered" ? 4 : 0);
  });

  it("rpc_edit_stock_request: the requester (or an admin) edits while pending; nothing after", async () => {
    const id = await insertRequest({ status: "pending", qty: 1000 });
    const site = await client(SITE_EMAIL);
    const ok = await site.rpc("rpc_edit_stock_request", {
      p_request_id: id,
      p_qty: 100,
      p_needed_by: null,
      p_note: "typo fixed",
    });
    expect(ok.error).toBeNull();
    const row = one(await sql`select qty::float as qty, note from public.stock_requests where id = ${id}`, "edited");
    expect(row).toEqual({ qty: 100, note: "typo fixed" });
    const audit = await sql`select action from public.audit_log where entity_type = 'stock_request' and entity_id = ${id}`;
    expect(audit.map((a) => a.action)).toContain("edit");

    const zero = await site.rpc("rpc_edit_stock_request", { p_request_id: id, p_qty: 0 });
    expect(zero.error?.message).toMatch(/^REASON_REQUIRED/);
    const past = await site.rpc("rpc_edit_stock_request", { p_request_id: id, p_qty: 1, p_needed_by: "2020-01-01" });
    expect(past.error?.message).toMatch(/^REASON_REQUIRED/);

    const c = await client(CLIENT_EMAIL);
    const byClient = await c.rpc("rpc_edit_stock_request", { p_request_id: id, p_qty: 5 });
    expect(byClient.error?.message).toMatch(/^FORBIDDEN/);

    const admin = await client(ADMIN_EMAIL);
    expect((await admin.rpc("rpc_edit_stock_request", { p_request_id: id, p_qty: 90 })).error).toBeNull();
    await admin.rpc("rpc_transition_stock_request", { p_request_id: id, p_to_status: "approved" });
    const afterApprove = await site.rpc("rpc_edit_stock_request", { p_request_id: id, p_qty: 80 });
    expect(afterApprove.error?.message).toMatch(/^ILLEGAL_TRANSITION/);
  });

  it("a site supervisor cannot edit a pending request somebody else raised", async () => {
    const id = await insertRequest({ status: "pending", requestedBy: SEED.adminProfile });
    const site = await client(SITE_EMAIL);
    const { error } = await site.rpc("rpc_edit_stock_request", { p_request_id: id, p_qty: 2 });
    expect(error?.message).toMatch(/^FORBIDDEN/);
  });
});

// ── APX-44 ───────────────────────────────────────────────────────────────────
describe("APX-44 — a retried create with the same id is ALREADY_SUBMITTED", () => {
  const args = (id: string) => ({
    p_id: id,
    p_project_id: SEED.project,
    p_package_id: SEED.poolPackage,
    p_material_name: "Retry test material",
    p_qty: 2,
    p_unit: "bag",
  });

  it("a sequential retry creates nothing new", async () => {
    const id = crypto.randomUUID();
    trackedRequestIds.push(id);
    const site = await client(SITE_EMAIL);
    const first = await site.rpc("rpc_create_stock_request", args(id));
    expect(first.error).toBeNull();
    expect((first.data as { id: string; rate: unknown }).id).toBe(id);
    const second = await site.rpc("rpc_create_stock_request", args(id));
    expect(second.error?.message).toMatch(/^ALREADY_SUBMITTED/);
    expect(await sql`select id from public.stock_requests where id = ${id}`).toHaveLength(1);
  });

  it("two concurrent submits with one id create exactly one request", async () => {
    const id = crypto.randomUUID();
    trackedRequestIds.push(id);
    const a = await client(SITE_EMAIL);
    const b = await client(SITE_EMAIL);
    const [ra, rb] = await Promise.all([
      a.rpc("rpc_create_stock_request", args(id)),
      b.rpc("rpc_create_stock_request", args(id)),
    ]);
    const failed = [ra, rb].filter((r) => r.error);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error?.message).toMatch(/ALREADY_SUBMITTED|stock_requests_pkey/);
    expect(await sql`select id from public.stock_requests where id = ${id}`).toHaveLength(1);
  });

  it("omitting p_id still works (the mobile app does not send one yet)", async () => {
    const site = await client(SITE_EMAIL);
    const { data, error } = await site.rpc("rpc_create_stock_request", {
      p_project_id: SEED.project,
      p_package_id: SEED.poolPackage,
      p_material_name: "No id material",
      p_qty: 1,
      p_unit: "bag",
    });
    expect(error).toBeNull();
    trackedRequestIds.push((data as { id: string }).id);
  });
});

// ── APX-69 ───────────────────────────────────────────────────────────────────
describe("APX-69 — record usage", () => {
  it("site records usage on a package: an out movement, qty down, audited, no money returned", async () => {
    const item = await insertItem(10);
    const site = await client(SITE_EMAIL);
    const { data, error } = await site.rpc("rpc_record_stock_usage", {
      p_item_id: item,
      p_package_id: SEED.poolPackage,
      p_qty: 4,
      p_note: "Pool deck screed",
    });
    expect(error).toBeNull();
    expect(Number((data as { qty_on_hand: number }).qty_on_hand)).toBe(6);
    expect(JSON.stringify(data)).not.toMatch(/unit_cost|rate/);
    expect(await qtyOf(item)).toBe(6);
    const moves = await sql`select direction::text as d, qty::float as q, ref_type, ref_id, reason from public.stock_movements
                             where inventory_item_id = ${item} and ref_type = 'usage'`;
    expect(moves.map((m) => [m.d, m.q, m.ref_id, m.reason])).toEqual([["out", 4, SEED.poolPackage, "Pool deck screed"]]);
  });

  it("refuses more than is on hand, a zero quantity, a package of another project, and a client", async () => {
    const item = await insertItem(3);
    const site = await client(SITE_EMAIL);
    const tooMuch = await site.rpc("rpc_record_stock_usage", { p_item_id: item, p_package_id: SEED.poolPackage, p_qty: 4 });
    expect(tooMuch.error?.message).toMatch(/^NEGATIVE_STOCK/);
    const zero = await site.rpc("rpc_record_stock_usage", { p_item_id: item, p_package_id: SEED.poolPackage, p_qty: 0 });
    expect(zero.error?.message).toMatch(/^REASON_REQUIRED/);

    const otherPkg = one(
      await sql`select id from public.packages where project_id = ${OTHER_PROJECT} and deleted_at is null limit 1`,
      "other project package"
    ).id as string;
    const admin = await client(ADMIN_EMAIL);
    const wrongPkg = await admin.rpc("rpc_record_stock_usage", { p_item_id: item, p_package_id: otherPkg, p_qty: 1 });
    expect(wrongPkg.error?.message).toMatch(/^NOT_FOUND/);

    const c = await client(CLIENT_EMAIL);
    const byClient = await c.rpc("rpc_record_stock_usage", { p_item_id: item, p_package_id: SEED.poolPackage, p_qty: 1 });
    expect(byClient.error?.message).toMatch(/^FORBIDDEN/);
    expect(await qtyOf(item)).toBe(3);
  });

  it("two concurrent usages that together exceed the stock: one succeeds, stock never goes negative", async () => {
    const item = await insertItem(5);
    const a = await client(SITE_EMAIL);
    const b = await client(SITE_EMAIL);
    const [ra, rb] = await Promise.all([
      a.rpc("rpc_record_stock_usage", { p_item_id: item, p_package_id: SEED.poolPackage, p_qty: 3 }),
      b.rpc("rpc_record_stock_usage", { p_item_id: item, p_package_id: SEED.poolPackage, p_qty: 3 }),
    ]);
    const failed = [ra, rb].filter((r) => r.error);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error?.message).toMatch(/^NEGATIVE_STOCK/);
    expect(await qtyOf(item)).toBe(2);
  });
});

describe("APX-69 — partial delivery", () => {
  it("delivering 6 of 10 delivers 6 and leaves a linked request for 4 in Ordered", async () => {
    const item = await insertItem(0);
    const id = await insertRequest({ status: "ordered", qty: 10, rate: 50 });
    await sql`update public.stock_requests set inventory_item_id = ${item} where id = ${id}`;
    const site = await client(SITE_EMAIL);

    const { data, error } = await site.rpc("rpc_transition_stock_request", {
      p_request_id: id,
      p_to_status: "delivered",
      p_delivered_qty: 6,
    });
    expect(error).toBeNull();
    expect((data as { rate: unknown }).rate).toBeNull();

    const original = one(await sql`select status::text as s, qty::float as q from public.stock_requests where id = ${id}`, "o");
    expect(original).toEqual({ s: "delivered", q: 6 });
    const child = one(
      await sql`select status::text as s, qty::float as q, rate::float as r, inventory_item_id, ref_no
                  from public.stock_requests where split_from_id = ${id}`,
      "remainder"
    );
    expect(child.s).toBe("ordered");
    expect(child.q).toBe(4);
    expect(child.r).toBe(50);
    expect(child.inventory_item_id).toBe(item);
    expect(await qtyOf(item)).toBe(6);
  });

  it("refuses a delivered quantity above the request, zero, or given on another move", async () => {
    const id = await insertRequest({ status: "ordered", qty: 5 });
    const site = await client(SITE_EMAIL);
    const over = await site.rpc("rpc_transition_stock_request", { p_request_id: id, p_to_status: "delivered", p_delivered_qty: 6 });
    expect(over.error?.message).toMatch(/^REASON_REQUIRED/);
    const zero = await site.rpc("rpc_transition_stock_request", { p_request_id: id, p_to_status: "delivered", p_delivered_qty: 0 });
    expect(zero.error?.message).toMatch(/^REASON_REQUIRED/);

    const pending = await insertRequest({ status: "pending" });
    const admin = await client(ADMIN_EMAIL);
    const onApprove = await admin.rpc("rpc_transition_stock_request", {
      p_request_id: pending,
      p_to_status: "approved",
      p_delivered_qty: 1,
    });
    expect(onApprove.error?.message).toMatch(/^ILLEGAL_TRANSITION/);
    expect(await statusOf(id)).toBe("ordered");
  });

  it("the full quantity given explicitly is an ordinary delivery — no remainder", async () => {
    const id = await insertRequest({ status: "ordered", qty: 5 });
    const site = await client(SITE_EMAIL);
    const { error } = await site.rpc("rpc_transition_stock_request", { p_request_id: id, p_to_status: "delivered", p_delivered_qty: 5 });
    expect(error).toBeNull();
    expect(await sql`select id from public.stock_requests where split_from_id = ${id}`).toHaveLength(0);
  });
});

// ── APX-42 (approvals) ───────────────────────────────────────────────────────
describe("APX-42 — the requester withdraws a pending approval", () => {
  async function insertApproval(status: "pending" | "approved", requestedBy: string = SEED.siteProfile) {
    const rows = await sql`
      insert into public.approvals (org_id, project_id, package_id, ref_no, type, item, status, decided_at, requested_by, created_by)
      values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, ${"AP-FIX-" + tag()}, 'material_sample',
              'Withdraw test', ${status}, ${status === "pending" ? null : sql`now()`}, ${requestedBy}, ${requestedBy})
      returning id`;
    const id = one(rows, "approval").id as string;
    trackedApprovalIds.push(id);
    return id;
  }

  it("the requester withdraws it: soft-deleted, audited, gone from the client's list", async () => {
    const id = await insertApproval("pending");
    const site = await client(SITE_EMAIL);
    const { error } = await site.rpc("rpc_withdraw_approval", { p_approval_id: id });
    expect(error).toBeNull();
    expect(one(await sql`select deleted_at from public.approvals where id = ${id}`, "a").deleted_at).not.toBeNull();
    const c = await client(CLIENT_EMAIL);
    expect((await c.from("approvals").select("id").eq("id", id)).data).toEqual([]);
    const audit = await sql`select action from public.audit_log where entity_type = 'approval' and entity_id = ${id}`;
    expect(audit.map((a) => a.action)).toContain("withdraw");
  });

  it("nobody else may withdraw it, and a decided one cannot be withdrawn", async () => {
    const id = await insertApproval("pending");
    const admin = await client(ADMIN_EMAIL);
    expect((await admin.rpc("rpc_withdraw_approval", { p_approval_id: id })).error?.message).toMatch(/^FORBIDDEN/);
    const c = await client(CLIENT_EMAIL);
    expect((await c.rpc("rpc_withdraw_approval", { p_approval_id: id })).error?.message).toMatch(/^FORBIDDEN/);

    const decided = await insertApproval("approved");
    const site = await client(SITE_EMAIL);
    expect((await site.rpc("rpc_withdraw_approval", { p_approval_id: decided })).error?.message).toMatch(
      /^ILLEGAL_TRANSITION/
    );
  });

  it("withdraw racing a client decision: exactly one wins", async () => {
    const id = await insertApproval("pending");
    const site = await client(SITE_EMAIL);
    const c = await client(CLIENT_EMAIL);
    const [w, d] = await Promise.all([
      site.rpc("rpc_withdraw_approval", { p_approval_id: id }),
      c.rpc("rpc_decide_approval", { p_approval_id: id, p_decision: "approved" }),
    ]);
    expect([w.error, d.error].filter((e) => e === null)).toHaveLength(1);
  });
});
