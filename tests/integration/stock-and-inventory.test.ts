import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { connect } from "./db";
import { SEED } from "./db";
import { one } from "./expect-row";
import { inventorySearchFilter } from "@/features/inventory/service";

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

describe("rpc_adjust_inventory — organisation scope (20261008090001)", () => {
  // A second organisation, built and torn down here on the privileged
  // connection: it has a central-store item and a project with an item. No
  // user of it is needed — the point is that THIS org's admin cannot reach it.
  const otherOrg = "00000000-0000-4000-8000-00000000ab01";
  const otherClient = "00000000-0000-4000-8000-00000000ab02";
  const otherProject = "00000000-0000-4000-8000-00000000ab03";
  const created: string[] = [];

  async function item(orgId: string, projectId: string | null, qty: number): Promise<string> {
    const rows = await sql`
      insert into public.inventory_items (org_id, project_id, name, unit, qty_on_hand, reorder_level, unit_cost, created_by)
      values (${orgId}, ${projectId}, 'Org-scope test item', 'bag', ${qty}, 0, 100, ${SEED.adminProfile})
      returning id`;
    const id = one(rows, "inserted inventory item").id as string;
    created.push(id);
    trackedItemIds.push(id);
    return id;
  }

  async function qtyOf(id: string): Promise<number> {
    return Number(
      one(await sql`select qty_on_hand from public.inventory_items where id = ${id}`, "item").qty_on_hand
    );
  }

  async function movementsOf(id: string) {
    return sql`select direction, qty, reason, ref_type, org_id from public.stock_movements where inventory_item_id = ${id} and ref_type = 'adjustment' order by created_at`;
  }

  beforeAll(async () => {
    await sql`insert into public.orgs (id, name) values (${otherOrg}, 'Org-scope test org') on conflict (id) do nothing`;
    await sql`insert into public.clients (id, org_id, name) values (${otherClient}, ${otherOrg}, 'Org-scope test client') on conflict (id) do nothing`;
    await sql`
      insert into public.projects (id, org_id, client_id, code, name, start_date)
      values (${otherProject}, ${otherOrg}, ${otherClient}, 'ORGSCOPE', 'Org-scope test project', '2026-10-01')
      on conflict (id) do nothing`;
  });

  afterAll(async () => {
    if (created.length) {
      await sql`delete from public.stock_movements where inventory_item_id = any(${created})`;
      await sql`delete from public.inventory_items where id = any(${created})`;
    }
    await sql`delete from public.projects where id = ${otherProject}`;
    await sql`delete from public.clients where id = ${otherClient}`;
    await sql`delete from public.orgs where id = ${otherOrg}`;
  });

  it("an admin adjusts their own organisation's PROJECT item — absolute quantity, movement and audit as before", async () => {
    const id = await item(SEED.org, SEED.project, 10);
    const admin = await client(ADMIN_EMAIL);

    const { data, error } = await admin.rpc("rpc_adjust_inventory", {
      p_item_id: id,
      p_new_qty: 7,
      p_reason: "Org-scope test: own project item",
    });

    expect(error).toBeNull();
    expect(Number((data as { qty_on_hand: number }).qty_on_hand)).toBe(7);
    expect(await qtyOf(id)).toBe(7);
    const moves = await movementsOf(id);
    expect(moves.map((m) => [m.direction, Number(m.qty), m.reason, m.org_id])).toEqual([
      ["out", 3, "Org-scope test: own project item", SEED.org],
    ]);
    const audit =
      await sql`select action from public.audit_log where entity_type = 'inventory_item' and entity_id = ${id}`;
    expect(audit.map((a) => a.action)).toContain("adjust");
  });

  it("an admin adjusts their own organisation's CENTRAL-STORE item (no project)", async () => {
    const id = await item(SEED.org, null, 2);
    const admin = await client(ADMIN_EMAIL);

    const { error } = await admin.rpc("rpc_adjust_inventory", {
      p_item_id: id,
      p_new_qty: 5,
      p_reason: "Org-scope test: own central store",
    });

    expect(error).toBeNull();
    expect(await qtyOf(id)).toBe(5);
    expect((await movementsOf(id)).map((m) => [m.direction, Number(m.qty)])).toEqual([["in", 3]]);
  });

  it.each([
    ["central-store", null],
    ["project", otherProject],
  ] as const)(
    "an admin CANNOT adjust another organisation's %s item — NOT_FOUND, nothing written",
    async (_label, projectId) => {
      const id = await item(otherOrg, projectId, 10);
      const admin = await client(ADMIN_EMAIL);

      const { error } = await admin.rpc("rpc_adjust_inventory", {
        p_item_id: id,
        p_new_qty: 0,
        p_reason: "Org-scope test: another organisation's item",
      });

      // The same answer as an id that does not exist — never "it exists, but".
      expect(error?.message).toMatch(/^NOT_FOUND: inventory item .* does not exist$/);
      expect(await qtyOf(id)).toBe(10);
      expect(await movementsOf(id)).toEqual([]);
      const audit =
        await sql`select 1 from public.audit_log where entity_type = 'inventory_item' and entity_id = ${id}`;
      expect(audit).toHaveLength(0);
    }
  );

  it("an item stamped with this org but pointing at another organisation's project is refused too", async () => {
    // Inconsistent on purpose: the project rule is its own check, not implied
    // by the item's org_id.
    const id = await item(SEED.org, otherProject, 10);
    const admin = await client(ADMIN_EMAIL);

    const { error } = await admin.rpc("rpc_adjust_inventory", {
      p_item_id: id,
      p_new_qty: 1,
      p_reason: "Org-scope test: foreign project",
    });

    expect(error?.message).toMatch(/^NOT_FOUND/);
    expect(await qtyOf(id)).toBe(10);
  });

  it("a nonexistent id gives the identical NOT_FOUND", async () => {
    const admin = await client(ADMIN_EMAIL);

    const { error } = await admin.rpc("rpc_adjust_inventory", {
      p_item_id: "00000000-0000-4000-8000-00000000ffff",
      p_new_qty: 1,
      p_reason: "Org-scope test: missing",
    });

    expect(error?.message).toMatch(/^NOT_FOUND: inventory item .* does not exist$/);
  });

  it.each([
    ["site", SITE_EMAIL],
    ["client", CLIENT_EMAIL],
  ])("a %s session still cannot call it — FORBIDDEN, nothing written", async (_label, email) => {
    const id = await item(SEED.org, SEED.project, 10);
    const session = await client(email);

    const { error } = await session.rpc("rpc_adjust_inventory", {
      p_item_id: id,
      p_new_qty: 1,
      p_reason: "Org-scope test: not an admin",
    });

    expect(error?.message).toMatch(/FORBIDDEN/);
    expect(await qtyOf(id)).toBe(10);
  });

  it("an unauthenticated caller cannot call it at all", async () => {
    const id = await item(SEED.org, SEED.project, 10);

    const { error } = await anonClient().rpc("rpc_adjust_inventory", {
      p_item_id: id,
      p_new_qty: 1,
      p_reason: "Org-scope test: anonymous",
    });

    expect(error).not.toBeNull();
    expect(await qtyOf(id)).toBe(10);
  });

  it("validation is unchanged: no reason, then a negative quantity, are refused before any lookup", async () => {
    const admin = await client(ADMIN_EMAIL);
    const foreign = await item(otherOrg, null, 10);

    const noReason = await admin.rpc("rpc_adjust_inventory", {
      p_item_id: foreign,
      p_new_qty: 1,
      p_reason: "  ",
    });
    expect(noReason.error?.message).toMatch(/^REASON_REQUIRED/);
    const negative = await admin.rpc("rpc_adjust_inventory", {
      p_item_id: foreign,
      p_new_qty: -1,
      p_reason: "x",
    });
    expect(negative.error?.message).toMatch(/^REASON_REQUIRED/);
  });

  it("an unchanged quantity is still a no-op: no movement written", async () => {
    const id = await item(SEED.org, SEED.project, 4);
    const admin = await client(ADMIN_EMAIL);

    const { error } = await admin.rpc("rpc_adjust_inventory", {
      p_item_id: id,
      p_new_qty: 4,
      p_reason: "Org-scope test: no change",
    });

    expect(error).toBeNull();
    expect(await movementsOf(id)).toEqual([]);
  });
});

describe("rpc_inventory_stats — D40", () => {
  it("total_value is null for a site session, populated for admin", async () => {
    // D40: the RPC itself withholds total_value from a non-admin caller now
    // — found in review calling it directly (not through
    // features/inventory/queries.ts, which discarded it only in the DTO,
    // the "hide it in the UI" pattern AGENTS.md says to stop and flag).
    type StatsRow = { total_items: number; total_value: number | null };

    const site = await client(SITE_EMAIL);
    const { data: siteData, error: siteError } = await site.rpc("rpc_inventory_stats");
    expect(siteError).toBeNull();
    const siteRow = one(siteData as StatsRow[], "site inventory stats row");
    expect(siteRow.total_value).toBeNull();
    expect(Number(siteRow.total_items)).toBeGreaterThan(0);

    const admin = await client(ADMIN_EMAIL);
    const { data: adminData, error: adminError } = await admin.rpc("rpc_inventory_stats");
    expect(adminError).toBeNull();
    expect(one(adminData as StatsRow[], "admin inventory stats row").total_value).not.toBeNull();
  });
});

describe("rpc_inventory_stats — p_search matches the Inventory table's own filter", () => {
  it("counts exactly the rows inventorySearchFilter returns, for hostile input too", async () => {
    // The stat tiles and the table must describe the same rows for a `q`
    // search. Rather than restating the matching rules, compare the RPC's
    // count against the very PostgREST filter the table sends.
    const tag = `Srch${Date.now()}`;
    const names = [`${tag} M_20 grade`, `${tag} M120 grade`, `${tag} 100% acrylic`, `${tag} back\\slash`];
    for (const name of names) {
      const rows = await sql`
        insert into public.inventory_items (org_id, project_id, name, category, unit, qty_on_hand, reorder_level, unit_cost, created_by)
        values (${SEED.org}, ${SEED.project}, ${name}, null, 'bag', 0, 5, 100, ${SEED.adminProfile})
        returning id`;
      trackedItemIds.push(one(rows, "inserted search item").id);
    }
    const rows = await sql`
      insert into public.inventory_items (org_id, project_id, name, category, unit, qty_on_hand, reorder_level, unit_cost, created_by)
      values (${SEED.org}, ${SEED.project}, 'Plain widget', ${`${tag} category`}, 'bag', 0, 5, 100, ${SEED.adminProfile})
      returning id`;
    trackedItemIds.push(one(rows, "inserted category item").id);

    const terms = [
      tag,
      tag.toUpperCase(),
      `${tag} M_20`,
      `${tag} 100%`,
      `${tag} back\\slash`,
      `*${tag}*`,
      "_",
      "%",
    ];
    type StatsRow = { total_items: number };

    for (const [email, view] of [
      [ADMIN_EMAIL, "v_inventory_status"],
      [SITE_EMAIL, "v_inventory_site"],
    ] as const) {
      const session = await client(email);
      for (const term of terms) {
        const table = await session
          .from(view)
          .select("id", { count: "exact", head: true })
          .eq("project_id", SEED.project)
          .or(inventorySearchFilter(term));
        expect(table.error).toBeNull();

        const { data, error } = await session.rpc("rpc_inventory_stats", {
          p_project_id: SEED.project,
          p_search: term,
        });
        expect(error).toBeNull();
        const stats = one(data as StatsRow[], `stats row for ${email} / ${term}`);
        expect(Number(stats.total_items), `${email} searching ${JSON.stringify(term)}`).toBe(table.count);
      }
    }
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

/**
 * Migration 20261007090002: trg_stock_requests_ancestry. A request's package
 * must belong to its project, and its phase (when set) to that package and
 * project — on every write path, not just rpc_create_stock_request. Errors
 * are the domain NOT_FOUND (P0002), as the approval ancestry trigger's are.
 */
describe("stock_requests — project → package → phase ancestry", () => {
  /** Seed: project c2's only package, and a phase of c1's OTHER package. */
  const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000c2";
  const OTHER_PROJECT_PACKAGE = "00000000-0000-4000-8000-0000000000e7";
  const OTHER_PACKAGE_PHASE = "00000000-0000-4000-8000-000000000f11"; // c1 / e2

  async function createVia(as: SupabaseClient, packageId: string, phaseId: string | null) {
    const result = await as.rpc("rpc_create_stock_request", {
      p_project_id: SEED.project,
      p_package_id: packageId,
      p_phase_id: phaseId,
      p_material_name: "Ancestry test material",
      p_qty: 1,
      p_unit: "bag",
    });
    if (!result.error) trackedRequestIds.push((result.data as { id: string }).id);
    return result;
  }

  it("accepts a package of the project", async () => {
    const site = await client(SITE_EMAIL);

    const { data, error } = await createVia(site, SEED.poolPackage, null);

    expect(error).toBeNull();
    const row = one(
      await sql`select project_id, package_id from public.stock_requests where id = ${(data as { id: string }).id}`,
      "created request"
    );
    expect(row).toEqual({ project_id: SEED.project, package_id: SEED.poolPackage });
  });

  it("refuses a package from another project with NOT_FOUND", async () => {
    const site = await client(SITE_EMAIL);

    const { data, error } = await createVia(site, OTHER_PROJECT_PACKAGE, null);

    expect(data).toBeNull();
    expect(error?.code).toBe("P0002");
    expect(error?.message).toMatch(/^NOT_FOUND: package .* does not exist in this project$/);
  });

  it("accepts a matching package and phase", async () => {
    const site = await client(SITE_EMAIL);

    const { data, error } = await createVia(site, SEED.poolPackage, SEED.phaseWaterproofing);

    expect(error).toBeNull();
    const row = one(
      await sql`select package_id, phase_id from public.stock_requests where id = ${(data as { id: string }).id}`,
      "created request"
    );
    expect(row).toEqual({ package_id: SEED.poolPackage, phase_id: SEED.phaseWaterproofing });
  });

  it("refuses a phase from another package in the same project with NOT_FOUND", async () => {
    const site = await client(SITE_EMAIL);

    const { data, error } = await createVia(site, SEED.poolPackage, OTHER_PACKAGE_PHASE);

    expect(data).toBeNull();
    expect(error?.code).toBe("P0002");
    expect(error?.message).toMatch(/^NOT_FOUND: phase .* does not exist in this package$/);
  });

  it("refuses a phase from another project with NOT_FOUND", async () => {
    const phase = one(
      await sql`insert into public.phases (org_id, project_id, package_id, seq_no, name)
                values (${SEED.org}, ${OTHER_PROJECT}, ${OTHER_PROJECT_PACKAGE}, 93, 'Stock ancestry fixture phase')
                returning id`,
      "fixture phase in another project"
    );
    try {
      const site = await client(SITE_EMAIL);

      const { data, error } = await createVia(site, SEED.poolPackage, phase.id);

      expect(data).toBeNull();
      expect(error?.code).toBe("P0002");
      expect(error?.message).toMatch(/^NOT_FOUND: phase .* does not exist in this package$/);
    } finally {
      await sql`delete from public.phases where id = ${phase.id}`;
    }
  });

  it("keeps a null phase valid (the phase checks are skipped)", async () => {
    const site = await client(SITE_EMAIL);

    const { data, error } = await createVia(site, SEED.poolPackage, null);

    expect(error).toBeNull();
    const row = one(
      await sql`select phase_id from public.stock_requests where id = ${(data as { id: string }).id}`,
      "created request"
    );
    expect(row.phase_id).toBeNull();
  });

  it("refuses an UPDATE that moves a request onto another project's package or another package's phase", async () => {
    // Directly on the table (the privileged connection skips RLS), so the
    // only thing that can refuse these writes is the trigger itself.
    const id = await insertTestRequest({ status: "pending", refSuffix: "ANCESTRY-UPD" });

    await expect(
      sql`update public.stock_requests set package_id = ${OTHER_PROJECT_PACKAGE}, phase_id = null where id = ${id}`
    ).rejects.toThrow(/NOT_FOUND: package .* does not exist in this project/);
    await expect(
      sql`update public.stock_requests set phase_id = ${OTHER_PACKAGE_PHASE} where id = ${id}`
    ).rejects.toThrow(/NOT_FOUND: phase .* does not exist in this package/);

    const row = one(
      await sql`select package_id, phase_id from public.stock_requests where id = ${id}`,
      "unchanged request"
    );
    expect(row).toEqual({ package_id: SEED.poolPackage, phase_id: SEED.phaseWaterproofing });
  });
});

/**
 * Migration 20261007090006, gap A: sr_insert is gone. A normal session can no
 * longer INSERT into stock_requests directly — rpc_create_stock_request is the
 * only way in (its own tests above still pass unchanged).
 */
describe("stock_requests — no direct insert", () => {
  function directRow(refSuffix: string) {
    return {
      org_id: SEED.org,
      project_id: SEED.project,
      package_id: SEED.poolPackage,
      ref_no: `SR-TEST-DIRECT-${refSuffix}`,
      material_name: "Direct insert attempt",
      qty: 1,
      unit: "bag",
      rate: 99999,
      status: "approved",
      requested_by: SEED.siteProfile,
      created_by: SEED.siteProfile,
    };
  }

  it.each([
    ["a site session", SITE_EMAIL],
    ["an admin session", ADMIN_EMAIL],
  ])("refuses %s inserting a row straight into the table", async (_label, email) => {
    const as = await client(email);
    const ref = `${email.split("@")[0]}-${Date.now()}`;

    const { error } = await as.from("stock_requests").insert(directRow(ref));

    expect(error?.code).toBe("42501");
    const rows = await sql`select id from public.stock_requests where ref_no = ${"SR-TEST-DIRECT-" + ref}`;
    expect(rows.length).toBe(0);
  });

  it("still creates a request through rpc_create_stock_request", async () => {
    const site = await client(SITE_EMAIL);

    const { data, error } = await site.rpc("rpc_create_stock_request", {
      p_project_id: SEED.project,
      p_package_id: SEED.poolPackage,
      p_material_name: "RPC still works",
      p_qty: 2,
      p_unit: "bag",
    });

    expect(error).toBeNull();
    const row = data as { id: string; status: string };
    trackedRequestIds.push(row.id);
    expect(row.status).toBe("pending");
  });
});

/**
 * Migration 20261007090006, gap B: rpc_transition_stock_request still returns
 * the row, but a non-admin caller gets it without `rate` and
 * `billed_on_bill_id` (the two columns v_stock_request_site omits). The
 * database row itself keeps both; an admin's return is unchanged.
 */
describe("rpc_transition_stock_request — the returned row carries no money for a non-admin", () => {
  it("returns a site supervisor's delivery without rate or billed_on_bill_id", async () => {
    const itemId = await insertTestItem(0);
    const requestId = await insertTestRequest({
      status: "ordered",
      refSuffix: `RATE-SITE-${Date.now()}`,
      inventoryItemId: itemId,
    });
    const site = await client(SITE_EMAIL);

    const { data, error } = await site.rpc("rpc_transition_stock_request", {
      p_request_id: requestId,
      p_to_status: "delivered",
    });

    expect(error).toBeNull();
    const row = data as Record<string, unknown>;
    expect(row.id).toBe(requestId);
    expect(row.status).toBe("delivered");
    expect(row.project_id).toBe(SEED.project);
    expect(row.rate).toBeNull();
    expect(row.billed_on_bill_id).toBeNull();
    // Only the RETURN is stripped: the stored rate is untouched.
    const stored = one(
      await sql`select rate::float as rate from public.stock_requests where id = ${requestId}`,
      "request"
    );
    expect(stored.rate).toBe(100);
  });

  it("returns an admin's transition with its rate, as before", async () => {
    const requestId = await insertTestRequest({ status: "pending", refSuffix: `RATE-ADMIN-${Date.now()}` });
    const admin = await client(ADMIN_EMAIL);

    const { data, error } = await admin.rpc("rpc_transition_stock_request", {
      p_request_id: requestId,
      p_to_status: "approved",
    });

    expect(error).toBeNull();
    const row = data as { id: string; status: string; project_id: string; rate: number | string | null };
    expect(row.status).toBe("approved");
    expect(Number(row.rate)).toBe(100);
  });
});

/**
 * Migration 20261007090006, gap C: trg_stock_requests_inventory_item. A
 * request's inventory_item_id must be an item of its own organisation, in its
 * own project or the central store (project_id NULL); anything else is
 * NOT_FOUND (P0002), on every write path. A null id is untouched.
 */
describe("stock_requests — inventory_item_id belongs to this request's org and project", () => {
  const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000c2";

  async function itemIn(projectId: string | null, orgId: string = SEED.org): Promise<string> {
    const row = one(
      await sql`insert into public.inventory_items (org_id, project_id, name, unit, qty_on_hand, reorder_level, unit_cost, created_by)
                values (${orgId}, ${projectId}, ${"Ownership test item " + crypto.randomUUID()}, 'bag', 0, 0, 0, ${SEED.adminProfile})
                returning id`,
      "inserted inventory item"
    );
    trackedItemIds.push(row.id);
    return row.id;
  }

  async function createWith(itemId: string | null) {
    const admin = await client(ADMIN_EMAIL);
    const result = await admin.rpc("rpc_create_stock_request", {
      p_project_id: SEED.project,
      p_package_id: SEED.poolPackage,
      p_material_name: "Ownership test material",
      p_qty: 1,
      p_unit: "bag",
      p_inventory_item_id: itemId,
    });
    if (!result.error) trackedRequestIds.push((result.data as { id: string }).id);
    return result;
  }

  it("accepts an item of the same project", async () => {
    const { error } = await createWith(await itemIn(SEED.project));

    expect(error).toBeNull();
  });

  it("accepts a central-store item of the same organisation (project_id null)", async () => {
    const { error } = await createWith(await itemIn(null));

    expect(error).toBeNull();
  });

  it("keeps a null inventory_item_id valid — a new material", async () => {
    const { data, error } = await createWith(null);

    expect(error).toBeNull();
    expect((data as { inventory_item_id: string | null }).inventory_item_id).toBeNull();
  });

  it("refuses an item of another project with NOT_FOUND", async () => {
    const { data, error } = await createWith(await itemIn(OTHER_PROJECT));

    expect(data).toBeNull();
    expect(error?.code).toBe("P0002");
    expect(error?.message).toMatch(/^NOT_FOUND: inventory item .* does not exist in this project$/);
  });

  it("refuses an item of another organisation with NOT_FOUND", async () => {
    const org = one(
      await sql`insert into public.orgs (name) values ('Ownership test org') returning id`,
      "fixture org"
    );
    try {
      const { data, error } = await createWith(await itemIn(null, org.id));

      expect(data).toBeNull();
      expect(error?.code).toBe("P0002");
    } finally {
      await sql`delete from public.inventory_items where org_id = ${org.id}`;
      trackedItemIds.length = 0;
      await sql`delete from public.orgs where id = ${org.id}`;
    }
  });

  it("refuses an item id that does not exist with NOT_FOUND", async () => {
    const { data, error } = await createWith(crypto.randomUUID());

    expect(data).toBeNull();
    expect(error?.code).toBe("P0002");
  });

  it("refuses a direct UPDATE that points a request at another project's item", async () => {
    // The privileged connection skips RLS: only the trigger can refuse this.
    const requestId = await insertTestRequest({ status: "pending", refSuffix: `INV-UPD-${Date.now()}` });
    const foreign = await itemIn(OTHER_PROJECT);

    await expect(
      sql`update public.stock_requests set inventory_item_id = ${foreign} where id = ${requestId}`
    ).rejects.toThrow(/NOT_FOUND: inventory item .* does not exist in this project/);
  });

  it("still lets a delivery link the item it creates for a new material", async () => {
    const requestId = await insertTestRequest({ status: "ordered", refSuffix: `INV-DELIVER-${Date.now()}` });
    const admin = await client(ADMIN_EMAIL);

    const { error } = await admin.rpc("rpc_transition_stock_request", {
      p_request_id: requestId,
      p_to_status: "delivered",
    });

    expect(error).toBeNull();
    const linked = one(
      await sql`select inventory_item_id from public.stock_requests where id = ${requestId}`,
      "delivered request"
    );
    expect(linked.inventory_item_id).not.toBeNull();
    trackedItemIds.push(linked.inventory_item_id);
  });
});
