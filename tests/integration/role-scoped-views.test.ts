import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SEED } from "./db";

/**
 * AGENTS.md database rule 8: RLS is tested from a real client SDK session,
 * never from the SQL editor or a privileged connection — those bypass RLS and
 * would report a broken policy as working. `supabase/tests/01_policy_matrix_test.sql`
 * is the fast structural companion (which columns exist); this file is the
 * behavioural assertion it explicitly defers to a client-SDK suite.
 *
 * build/04-projects-packages-phases.md §5: a client session reading
 * v_package_client gets allocated_amount and no internal column; a site
 * session reading v_package_site/v_phase_site gets no money column at all;
 * T-11 re-asserted for the two views this build added (v_phase_site) and
 * fixed (v_phase_client, v_phase_site — see docs/decisions.md D21).
 */

const PASSWORD = "apex-dev-only";
const CLIENT_EMAIL = "tvrao@example.invalid";
const SITE_EMAIL = "ravi@beapex.in";

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

const FORBIDDEN_MONEY_COLUMNS = [
  "internal_amount",
  "internal_cost",
  "internal_cost_amount",
  "margin_amount",
  "committed",
  "remaining",
  "used_pct",
];

describe("v_package_client (client role)", () => {
  it("returns rows and allocated_amount, aliased as contract_value", async () => {
    const supabase = await client(CLIENT_EMAIL);
    const { data, error } = await supabase
      .from("v_package_client")
      .select("*")
      .eq("id", SEED.poolPackage)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data).toHaveProperty("contract_value");
    expect(typeof data?.contract_value).toBe("number");
  });

  it("never carries a cost or margin column, whatever comes back", async () => {
    const supabase = await client(CLIENT_EMAIL);
    const { data, error } = await supabase.from("v_package_client").select("*").limit(5);
    expect(error).toBeNull();
    for (const row of data ?? []) {
      for (const col of FORBIDDEN_MONEY_COLUMNS) {
        expect(Object.keys(row)).not.toContain(col);
      }
    }
  });
});

describe("v_package_site / v_phase_site (site role)", () => {
  it("v_package_site returns rows with no money column at all", async () => {
    const supabase = await client(SITE_EMAIL);
    const { data, error } = await supabase
      .from("v_package_site")
      .select("*")
      .eq("id", SEED.poolPackage)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    for (const col of [...FORBIDDEN_MONEY_COLUMNS, "allocated_amount", "contract_value"]) {
      expect(Object.keys(data ?? {})).not.toContain(col);
    }
    expect(data).toHaveProperty("open_requests");
    expect(data).toHaveProperty("phase_count");
  });

  it("v_phase_site returns rows for a package's phases (T-11: was 0 before D21's fix)", async () => {
    const supabase = await client(SITE_EMAIL);
    const { data, error } = await supabase.from("v_phase_site").select("*").eq("package_id", SEED.poolPackage);
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      for (const col of [...FORBIDDEN_MONEY_COLUMNS, "allocated_amount", "contract_value"]) {
        expect(Object.keys(row)).not.toContain(col);
      }
    }
  });
});

describe("v_phase_client (client role)", () => {
  it("returns rows with contract_value and no internal column (T-11: was 0 before D21's fix)", async () => {
    const supabase = await client(CLIENT_EMAIL);
    const { data, error } = await supabase.from("v_phase_client").select("*").eq("package_id", SEED.poolPackage);
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      expect(Object.keys(row)).toContain("contract_value");
      for (const col of FORBIDDEN_MONEY_COLUMNS) {
        expect(Object.keys(row)).not.toContain(col);
      }
    }
  });
});

describe("v_client_name (non-admin client-name lookup, D21)", () => {
  it("exposes only id and name, never contact_person/email/phone/gstin/billing_address", async () => {
    for (const email of [CLIENT_EMAIL, SITE_EMAIL]) {
      const supabase = await client(email);
      const { data, error } = await supabase.from("v_client_name").select("*").limit(1);
      expect(error).toBeNull();
      for (const row of data ?? []) {
        expect(Object.keys(row).sort()).toEqual(["id", "name"]);
      }
    }
  });

  it("a client/site session cannot read the clients table directly", async () => {
    for (const email of [CLIENT_EMAIL, SITE_EMAIL]) {
      const supabase = await client(email);
      const { data, error } = await supabase.from("clients").select("*");
      // RLS silently returns zero rows rather than an error for a select the
      // caller has no policy for.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });
});

describe("admin sees the full picture (control case)", () => {
  it("v_package_rollup carries internal_amount and committed for the admin role", async () => {
    const supabase = await client("suresh@beapex.in");
    const { data, error } = await supabase
      .from("v_package_rollup")
      .select("*")
      .eq("package_id", SEED.poolPackage)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toHaveProperty("internal_amount");
    expect(data).toHaveProperty("committed");
  });
});
