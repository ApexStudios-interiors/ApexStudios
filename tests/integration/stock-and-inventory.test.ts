import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { connect } from "./db";
import { SEED } from "./db";
import { one } from "./expect-row";

/**
 * build/07-stock-inventory-notifications.md. AGENTS.md's own testing table:
 * "New RPC → Integration test including the illegal-transition and
 * concurrency cases." Tested from real client-SDK sessions (AGENTS.md
 * database rule 8) — `rpc_transition_stock_request`/`rpc_create_stock_request`
 * call `auth_role()`/`auth.uid()` internally, so a raw privileged connection
 * with no JWT claims would not exercise the same code path a real caller
 * does (unlike `rpc_claim_jobs`, which needs no user context at all — see
 * jobs.test.ts's own comment on why that one is tested over a plain
 * connection).
 */

const PASSWORD = "apex-dev-only";
const SITE_EMAIL = "ravi@beapex.in";
const ADMIN_EMAIL = "suresh@beapex.in";

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

// Every test-owned row is tracked here and swept up afterwards, so a failed
// assertion never leaves a stray SR-TEST-* row, movement or inventory item
// behind. Deliveries mutate `inventory_items.qty_on_hand` as a side effect —
// a request row alone is not enough to track, or a failed assertion earlier
// in this file left the SEEDED cement item's cache permanently off by the
// delivered qty once its own movement row was swept up without it (caught
// live while writing this suite: `pnpm db:seed`'s own opening-balance rows
// stayed correct, but the cache didn't, until this file created its own
// disposable inventory items instead of touching a seeded one).
const trackedRequestIds: string[] = [];
const trackedItemIds: string[] = [];
afterEach(async () => {
  if (trackedRequestIds.length) {
    await sql`delete from public.stock_request_events where request_id = any(${trackedRequestIds})`;
    await sql`delete from public.stock_movements where ref_type = 'stock_request' and ref_id = any(${trackedRequestIds})`;
    await sql`update public.stock_requests set inventory_item_id = null where id = any(${trackedRequestIds})`;
    await sql`delete from public.stock_requests where id = any(${trackedRequestIds})`;
    trackedRequestIds.length = 0;
  }
  if (trackedItemIds.length) {
    await sql`delete from public.stock_movements where inventory_item_id = any(${trackedItemIds})`;
    await sql`delete from public.inventory_items where id = any(${trackedItemIds})`;
    trackedItemIds.length = 0;
  }
});
afterAll(async () => {
  await Promise.all(openClients.map((c) => c.auth.signOut()));
  await sql.end({ timeout: 5 });
});

/** A disposable inventory item this file owns outright, never a seeded one —
 *  so a delivery's cache mutation has nothing shared left to corrupt. */
async function insertTestItem(qtyOnHand: number): Promise<string> {
  const rows = await sql`
    insert into public.inventory_items (org_id, project_id, name, unit, qty_on_hand, reorder_level, unit_cost, created_by)
    values (${SEED.org}, ${SEED.project}, 'Integration test item', 'bag', ${qtyOnHand}, 5, 100, ${SEED.adminProfile})
    returning id`;
  const row = one(rows, "inserted inventory item");
  trackedItemIds.push(row.id);
  if (qtyOnHand > 0) {
    await sql`
      insert into public.stock_movements (org_id, inventory_item_id, project_id, direction, qty, unit_cost, ref_type, reason, created_by)
      values (${SEED.org}, ${row.id}, ${SEED.project}, 'in', ${qtyOnHand}, 100, 'adjustment', 'Integration test opening balance', ${SEED.adminProfile})`;
  }
  return row.id;
}

async function insertTestRequest(overrides: {
  status: "pending" | "approved" | "ordered";
  refSuffix: string;
  inventoryItemId?: string;
  qty?: number;
}): Promise<string> {
  const rows = await sql`
    insert into public.stock_requests (
      org_id, project_id, package_id, phase_id, ref_no, inventory_item_id,
      material_name, qty, unit, rate, status, requested_by, created_by,
      approved_by, approved_at, ordered_at
    ) values (
      ${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, ${SEED.phaseWaterproofing},
      ${"SR-TEST-" + overrides.refSuffix}, ${overrides.inventoryItemId ?? null},
      'Integration test material', ${overrides.qty ?? 5}, 'bag', 100,
      ${overrides.status}, ${SEED.siteProfile}, ${SEED.siteProfile},
      ${overrides.status === "pending" ? null : SEED.adminProfile},
      ${overrides.status === "pending" ? null : sql`now()`},
      ${overrides.status === "ordered" ? sql`now()` : null}
    ) returning id`;
  const row = one(rows, "inserted stock request");
  trackedRequestIds.push(row.id);
  return row.id;
}

describe("rpc_transition_stock_request — T-06 concurrency", () => {
  it("two concurrent deliveries of the same request increment stock exactly once", async () => {
    const itemId = await insertTestItem(10);
    const requestId = await insertTestRequest({
      status: "ordered",
      refSuffix: `CONC-${Date.now()}`,
      inventoryItemId: itemId,
      qty: 3,
    });

    const siteA = await client(SITE_EMAIL);
    const siteB = await signedInAs(SITE_EMAIL);
    openClients.push(siteB);

    const [ra, rb] = await Promise.all([
      siteA.rpc("rpc_transition_stock_request", { p_request_id: requestId, p_to_status: "delivered" }),
      siteB.rpc("rpc_transition_stock_request", { p_request_id: requestId, p_to_status: "delivered" }),
    ]);

    const results = [ra, rb];
    const succeeded = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);

    // The row lock (`for update`) serialises the two calls; the second one
    // re-reads status = 'delivered' after the first commits and fails the
    // legality check — it does not error trying to acquire the lock itself.
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0]?.error?.message).toMatch(/ILLEGAL_TRANSITION/);

    const afterRows = await sql`select qty_on_hand from public.inventory_items where id = ${itemId}`;
    expect(Number(one(afterRows, "inventory item after delivery").qty_on_hand)).toBe(13); // 10 opening + 3 delivered, exactly once

    const movements = await sql`
      select id from public.stock_movements where ref_type = 'stock_request' and ref_id = ${requestId}`;
    expect(movements.length).toBe(1);
  });
});

describe("rpc_transition_stock_request — T-07 illegal transition", () => {
  it("pending → delivered directly is refused", async () => {
    const requestId = await insertTestRequest({ status: "pending", refSuffix: `ILLEGAL-${Date.now()}` });
    const admin = await client(ADMIN_EMAIL);
    const { error } = await admin.rpc("rpc_transition_stock_request", {
      p_request_id: requestId,
      p_to_status: "delivered",
    });
    expect(error?.message).toMatch(/ILLEGAL_TRANSITION/);

    const rows = await sql`select status from public.stock_requests where id = ${requestId}`;
    expect(one(rows, "stock request after refused transition").status).toBe("pending");
  });
});

describe("rpc_transition_stock_request — T-08 reject without a reason", () => {
  it("is refused at the database, not just in the UI", async () => {
    const requestId = await insertTestRequest({ status: "pending", refSuffix: `NOREASON-${Date.now()}` });
    const admin = await client(ADMIN_EMAIL);
    const { error } = await admin.rpc("rpc_transition_stock_request", {
      p_request_id: requestId,
      p_to_status: "rejected",
    });
    expect(error?.message).toMatch(/REASON_REQUIRED/);
  });

  it("succeeds once a reason is given", async () => {
    const requestId = await insertTestRequest({ status: "pending", refSuffix: `REASON-${Date.now()}` });
    const admin = await client(ADMIN_EMAIL);
    const { data, error } = await admin.rpc("rpc_transition_stock_request", {
      p_request_id: requestId,
      p_to_status: "rejected",
      p_note: "Vendor cannot supply this spec",
    });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("rejected");
  });
});

describe("rpc_transition_stock_request — rate stripped for a non-admin session", () => {
  it("a site session's created request never carries a rate, even if the RPC is called directly with one", async () => {
    const site = await client(SITE_EMAIL);
    const { data, error } = await site.rpc("rpc_create_stock_request", {
      p_project_id: SEED.project,
      p_package_id: SEED.poolPackage,
      p_material_name: "Rate-strip attack test",
      p_qty: 1,
      p_unit: "bag",
      p_rate: 99999, // A site session attempting to smuggle a rate through directly.
    });
    expect(error).toBeNull();
    const row = data as { id: string; rate: number | null };
    trackedRequestIds.push(row.id);
    // v_stock_request_site never carries `rate` at all — but confirm the
    // second, harder boundary too: the RPC itself refused to store it,
    // regardless of what the caller asked for.
    const dbRows = await sql`select rate from public.stock_requests where id = ${row.id}`;
    expect(one(dbRows, "created stock request").rate).toBeNull();
  });
});

describe("rpc_adjust_inventory — T-09 negative quantity refused", () => {
  it("rejects a new quantity below zero", async () => {
    const admin = await client(ADMIN_EMAIL);
    const { error } = await admin.rpc("rpc_adjust_inventory", {
      p_item_id: SEED.cementItem,
      p_new_qty: -5,
      p_reason: "Integration test: should be refused",
    });
    expect(error?.message).toMatch(/REASON_REQUIRED|negative/);
  });

  it("rejects a missing reason", async () => {
    const admin = await client(ADMIN_EMAIL);
    const { error } = await admin.rpc("rpc_adjust_inventory", {
      p_item_id: SEED.cementItem,
      p_new_qty: 10,
      p_reason: "",
    });
    expect(error?.message).toMatch(/REASON_REQUIRED/);
  });

  it("a site session cannot call it at all", async () => {
    const site = await client(SITE_EMAIL);
    const { error } = await site.rpc("rpc_adjust_inventory", {
      p_item_id: SEED.cementItem,
      p_new_qty: 10,
      p_reason: "Site attempting an admin-only adjustment",
    });
    expect(error?.message).toMatch(/FORBIDDEN/);
  });
});

describe("rpc_inventory_drift — T-10", () => {
  it("detects an un-ledgered mutation and leaves the cache untouched", async () => {
    // A disposable item, never a seeded one: this test deliberately injects
    // an un-ledgered write, and a try/finally around it is not a substitute
    // for owning the row outright — a crashed process between the injection
    // and the restore would still leave a shared item corrupted.
    const itemId = await insertTestItem(40);
    try {
      // Simulate the exact bug class this RPC exists to catch: a write to
      // qty_on_hand with no stock_movements row behind it (AGENTS.md
      // database rule 4 forbids this in application code — this is the
      // failure mode, not a sanctioned path).
      await sql`update public.inventory_items set qty_on_hand = 999 where id = ${itemId}`;

      // rpc_inventory_drift is service_role-only (least privilege — no real
      // user session has a legitimate reason to run it). Called here over
      // the plain privileged connection, not a service_role supabase-js
      // client: the same reasoning (and the same missing-secret-in-CI gap,
      // found live) `rpc_claim_jobs` already settled in jobs.test.ts's own
      // comment — this function takes no `auth.uid()`-shaped context either,
      // so a raw connection exercises exactly what it does.
      const drift = await sql`select item_id, name, cached_qty, ledger_qty from public.rpc_inventory_drift()`;
      const drifted = drift.find((d) => d.item_id === itemId);
      expect(drifted).toBeDefined();
      expect(Number(drifted?.cached_qty)).toBe(999);
      expect(Number(drifted?.ledger_qty)).toBe(40);

      // The RPC only reports drift — it must never correct it itself.
      const afterRows = await sql`select qty_on_hand from public.inventory_items where id = ${itemId}`;
      expect(Number(one(afterRows, "drifted inventory item").qty_on_hand)).toBe(999);
    } finally {
      // afterEach deletes this item outright regardless of qty_on_hand, so
      // there is nothing further to restore — this just confirms the drift
      // clears once the item (and its movements) is gone.
      // No cascade on this FK (migration 0006) — movements first, item second.
      await sql`delete from public.stock_movements where inventory_item_id = ${itemId}`;
      await sql`delete from public.inventory_items where id = ${itemId}`;
      trackedItemIds.splice(trackedItemIds.indexOf(itemId), 1);
      const clean = await sql`select item_id from public.rpc_inventory_drift()`;
      expect(clean.some((d) => d.item_id === itemId)).toBe(false);
    }
  });

  it("anon and authenticated cannot call it — service_role only", async () => {
    const anon = anonClient();
    const { error: anonError } = await anon.rpc("rpc_inventory_drift");
    expect(anonError).not.toBeNull();

    const site = await client(SITE_EMAIL);
    const { error: siteError } = await site.rpc("rpc_inventory_drift");
    expect(siteError).not.toBeNull();
  });
});

describe("rpc_create_stock_request — cross-project membership", () => {
  it("refuses a session with no membership on the target project", async () => {
    // T V Rao (client) has no project_members row on SEED.project's own
    // sibling projects — but more directly, a client cannot even reach
    // rpc_create_stock_request's role check. Use site against a fabricated,
    // non-existent project id instead, which is_member_of() also refuses.
    const site = await client(SITE_EMAIL);
    const fakeProjectId = "00000000-0000-4000-8000-00000000dead";
    const { error } = await site.rpc("rpc_create_stock_request", {
      p_project_id: fakeProjectId,
      p_package_id: SEED.poolPackage,
      p_material_name: "Should be refused",
      p_qty: 1,
      p_unit: "bag",
    });
    expect(error?.message).toMatch(/FORBIDDEN|NOT_FOUND/);
  });
});
