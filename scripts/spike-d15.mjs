/**
 * D15 — does a definer view still read a `force row level security` table?
 *
 * docs/build/02-database.md §2 says to run this before any table is written,
 * because a "no" invalidates the whole column-isolation design. It has to run
 * from a real client SDK session with a real JWT: the SQL editor and a
 * service_role connection both bypass RLS and will report a broken policy as
 * working (AGENTS.md database rule 8).
 *
 * Usage:  pnpm spike:d15
 * Needs:  DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *         SUPABASE_SERVICE_ROLE_KEY  — against a NON-PRODUCTION project.
 *
 * It creates a throwaway client user, a throwaway project membership and a
 * throwaway table, then removes all three. It refuses to touch production.
 */
import { config } from "dotenv";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

config({ path: ".env.local", quiet: true });

const {
  DATABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  SUPABASE_PROD_PROJECT_REF: PROD,
} = process.env;

for (const [k, v] of Object.entries({ DATABASE_URL, URL, ANON, SERVICE })) {
  if (!v || v.includes("placeholder")) {
    console.error(`✗ ${k} is missing or still a placeholder. The spike needs a real apex-dev project.`);
    process.exit(1);
  }
}
if (PROD && (DATABASE_URL.includes(PROD) || URL.includes(PROD))) {
  console.error("✗ Refusing to run the spike against production.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const email = `spike-${randomUUID()}@example.invalid`;
const password = randomUUID();
let userId;
let verdict = "UNKNOWN";

try {
  console.log("1. applying spike schema");
  await sql.unsafe(readFileSync("supabase/spikes/d15_definer_view_under_force_rls.sql", "utf8"));

  console.log("2. creating a throwaway client user");
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (cErr) throw cErr;
  userId = created.user.id;

  const [org] = await sql`select id from public.orgs limit 1`;
  if (!org) throw new Error("No org row. Run the seed first: pnpm db:reset");
  const [project] = await sql`select id from public.projects where deleted_at is null limit 1`;
  if (!project) throw new Error("No project row. Run the seed first: pnpm db:reset");

  await sql`
    insert into public.profiles (id, org_id, full_name, email, role)
    values (${userId}, ${org.id}, 'Spike Client', ${email}, 'client')
    on conflict (id) do update set role = 'client'`;
  await sql`
    insert into public.project_members (project_id, profile_id)
    values (${project.id}, ${userId}) on conflict do nothing`;
  await sql`
    insert into public.spike_costs (project_id, public_val, secret_val)
    values (${project.id}, 100.00, 999.99)`;

  console.log("3. signing in as that client (real JWT, RLS applies)");
  const asClient = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: sErr } = await asClient.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;

  const view = await asClient.from("v_spike_client").select("*");
  const base = await asClient.from("spike_costs").select("secret_val");

  const viewRows = view.data?.length ?? 0;
  const baseRows = base.data?.length ?? 0;

  console.log("\n── RESULT ──");
  console.log(
    `  definer view  v_spike_client : ${viewRows} row(s)${view.error ? ` (error: ${view.error.message})` : ""}`
  );
  console.log(
    `  base table    spike_costs    : ${baseRows} row(s)${base.error ? ` (error: ${base.error.message})` : ""}`
  );

  const viewWorks = viewRows > 0 && !view.error;
  const baseBlocked = baseRows === 0;

  if (viewWorks && baseBlocked) {
    verdict = "PASS";
    console.log("\n✓ PASS — a definer view reads through `force row level security`,");
    console.log("  and the base table stays closed. Proceed exactly as 02-lld.md §4.3 specifies.");
  } else if (!viewWorks && baseBlocked) {
    verdict = "FAIL";
    console.log("\n✗ FAIL — the definer view returns nothing. `force` applies to the view owner.");
    console.log("  The LLD's column-isolation design needs one of the three amendments in");
    console.log("  docs/build/02-database.md §2. Pick one, write it into 02-lld.md §4.3,");
    console.log("  record it as D15, and say so in the PR.");
  } else {
    verdict = "LEAK";
    console.log("\n‼ LEAK — the base table returned rows to a client session. Stop. The");
    console.log("  admin-only policy is not being applied at all; nothing else matters");
    console.log("  until that is understood.");
  }
} catch (e) {
  console.error("\n✗ spike failed to run:", e.message);
  process.exitCode = 1;
} finally {
  console.log("\n4. cleaning up");
  try {
    await sql`drop view if exists public.v_spike_client`;
    await sql`drop table if exists public.spike_costs`;
    if (userId) {
      await sql`delete from public.project_members where profile_id = ${userId}`;
      await sql`delete from public.profiles where id = ${userId}`;
      await admin.auth.admin.deleteUser(userId);
    }
  } catch (e) {
    console.error("  cleanup incomplete:", e.message);
  }
  await sql.end({ timeout: 5 });
  console.log(`   verdict: ${verdict}`);
}
