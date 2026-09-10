/**
 * READ ONLY. Reports what is already in a database, and whether Build 02 can
 * safely be applied to it.
 *
 * Runs no DDL, writes nothing, and never touches a row. Use it before pointing
 * migrations at an existing project.
 *
 * Usage: pnpm db:inspect
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL;
if (!url || url.includes("placeholder")) {
  console.error("✗ DATABASE_URL is missing or still a placeholder in .env.local");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

// Tables Build 02 creates. A collision on any of these is the deciding factor.
const OURS = new Set([
  "orgs",
  "profiles",
  "clients",
  "projects",
  "project_members",
  "units",
  "packages",
  "phases",
  "tasks",
  "inventory_items",
  "stock_movements",
  "stock_requests",
  "stock_request_events",
  "approvals",
  "daily_updates",
  "bills",
  "bill_lines",
  "bill_events",
  "payments",
  "attachments",
  "audit_log",
  "jobs",
]);
const OUR_TYPES = new Set([
  "app_role",
  "project_status",
  "package_status",
  "phase_billing_status",
  "stock_request_status",
  "approval_status",
  "approval_type",
  "bill_status",
  "bill_line_source",
  "movement_direction",
  "attachment_entity",
  "job_status",
]);

try {
  const [{ version }] = await sql`select version()`;
  console.log(`\nPostgres: ${String(version).split(" ").slice(0, 2).join(" ")}`);

  const major = Number(String(version).match(/PostgreSQL (\d+)/)?.[1] ?? 0);
  if (major < 15) {
    console.log(`  ⚠ Build 02 uses \`unique nulls not distinct\`, which needs 15+.`);
  }

  const tables = await sql`
    select c.relname as name,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as forced,
           coalesce(s.n_live_tup, 0) as rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_stat_user_tables s on s.relid = c.oid
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname`;

  const types = await sql`
    select t.typname as name from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typtype = 'e'`;

  const [{ count: authUsers }] = await sql`select count(*)::int from auth.users`;

  const migrations = await sql`
    select count(*)::int as count from information_schema.tables
     where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'`;
  let applied = 0;
  if (migrations[0].count > 0) {
    const [{ count }] = await sql`select count(*)::int from supabase_migrations.schema_migrations`;
    applied = count;
  }

  console.log(`\npublic schema: ${tables.length} table(s)`);
  const collisions = [];
  const foreign = [];
  for (const t of tables) {
    const mark = OURS.has(t.name) ? "COLLIDES" : "unrelated";
    if (OURS.has(t.name)) collisions.push(t);
    else foreign.push(t);
    const rls = t.rls ? (t.forced ? "rls+force" : "rls") : "NO RLS";
    console.log(`  ${t.name.padEnd(26)} ${String(t.rows).padStart(8)} rows  ${rls.padEnd(10)} ${mark}`);
  }

  const typeCollisions = types.filter((t) => OUR_TYPES.has(t.name));
  console.log(`\npublic enums: ${types.length} (${typeCollisions.length} collide with Build 02)`);
  console.log(`auth.users: ${authUsers} account(s)`);
  console.log(`supabase migrations already applied: ${applied}`);

  console.log("\n── VERDICT ──");
  const totalRows = tables.reduce((a, t) => a + Number(t.rows), 0);

  if (collisions.length > 0 || typeCollisions.length > 0) {
    console.log("✗ DO NOT point Build 02 at this database.");
    console.log(
      `  ${collisions.length} table(s) and ${typeCollisions.length} enum(s) share a name with Build 02.`
    );
    console.log("  Migration 0001 would fail on the first `create type`, and `pnpm db:reset`");
    console.log("  would DROP whatever is there. Use a separate project.");
  } else if (foreign.length > 0) {
    console.log("⚠ Usable, but not clean.");
    console.log(`  ${foreign.length} unrelated table(s) already exist, holding ${totalRows} row(s).`);
    console.log("  Two consequences worth knowing before you decide:");
    console.log("   1. `pnpm db:reset` drops EVERYTHING in this database, not just our tables.");
    console.log("   2. The structural pgTAP suite asserts that *every* table in public has RLS");
    console.log("      enabled and forced. Pre-existing tables without it will fail the suite");
    console.log("      for reasons that have nothing to do with our work.");
    const noRls = foreign.filter((t) => !t.rls);
    if (noRls.length > 0) {
      console.log(`  ${noRls.length} of them have NO RLS: ${noRls.map((t) => t.name).join(", ")}`);
      console.log("      (worth knowing regardless — Supabase serves those over PostgREST.)");
    }
  } else if (authUsers > 0) {
    console.log("⚠ Empty public schema, but the project has real accounts.");
    console.log(`  ${authUsers} auth user(s). The seed inserts its own; it will not touch these,`);
    console.log("  but `pnpm db:reset` is still destructive. Fine for a dev project.");
  } else {
    console.log("✓ Empty and safe. Point Build 02 at it.");
  }
  console.log();
} catch (e) {
  console.error("\n✗ could not inspect:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
