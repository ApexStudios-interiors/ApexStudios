import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SEED } from "./db";

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
    expect(rows.some((r) => r.kind === "stock_request" || r.kind === "inventory_low")).toBe(true);
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

describe("v_notifications — anon", () => {
  it("gets zero rows — this project's table grants are broad by platform default, RLS is the actual boundary", async () => {
    const supabase = anonClient();
    const { data, error } = await supabase.from("v_notifications").select("kind").eq("project_id", SEED.project);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
