/**
 * Generates lib/supabase/database.types.ts from the live database — a
 * Docker-free replacement for `supabase gen types typescript`.
 *
 * That command shells out to Docker even with `--db-url`, the same conflict
 * with D14 already found and fixed for `supabase test db` (scripts/run-pgtap.mjs)
 * and effectively for seeding (scripts/db-seed.mjs). This introspects
 * information_schema and pg_catalog directly through the `postgres` driver
 * already a project dependency.
 *
 * Lives under lib/supabase/, not db/: nothing in db/ (Drizzle's schema and
 * connection) ever needs this type — only @supabase/ssr's client generic does,
 * in lib/supabase/server.ts and client.ts. Putting it in db/ would put a
 * zero-risk, connection-free type file behind the D11 ESLint restriction that
 * exists to keep Drizzle's runtime out of request paths; ESLint's own pattern
 * matching on "@/db" turned out to prefix-match "@/db/types" too; rather than
 * fight the matcher, the file lives where it is actually consumed.
 *
 * The output shape matches what @supabase/ssr's generics expect closely enough
 * for real column-level type safety: enums, and Tables/Views with Row, Insert
 * and Update variants. It does not attempt Functions or Composite Types —
 * nothing in this codebase calls an RPC through the typed client generic yet
 * (RPCs are invoked with an explicit args/return shape at the call site), so
 * that gap costs nothing today. Extend it here if that changes.
 *
 * Usage: pnpm db:types
 */
import { config } from "dotenv";
import postgres from "postgres";
import { writeFileSync } from "node:fs";

config({ path: ".env.local", quiet: true });

const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
if (!url || url.includes("placeholder")) {
  console.error("✗ DATABASE_URL is missing or still a placeholder.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

// Postgres type -> TypeScript. Enums are substituted in by name afterward.
function tsType(pgType, enumNames) {
  if (enumNames.has(pgType)) return `Database["public"]["Enums"]["${pgType}"]`;
  const map = {
    uuid: "string",
    text: "string",
    varchar: "string",
    bpchar: "string",
    date: "string",
    timestamp: "string",
    timestamptz: "string",
    time: "string",
    timetz: "string",
    interval: "string",
    inet: "string",
    numeric: "string", // never a JS number — see db/schema/columns.ts
    int2: "number",
    int4: "number",
    int8: "string", // bigint/bigserial: string by default in postgres.js
    float4: "number",
    float8: "number",
    bool: "boolean",
    json: "Json",
    jsonb: "Json",
  };
  return map[pgType] ?? "unknown";
}

try {
  const enums = await sql`
    select t.typname as name, e.enumlabel as value
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
     order by t.typname, e.enumsortorder`;

  const enumsByName = new Map();
  for (const row of enums) {
    if (!enumsByName.has(row.name)) enumsByName.set(row.name, []);
    enumsByName.get(row.name).push(row.value);
  }
  const enumNames = new Set(enumsByName.keys());

  const tables = await sql`
    select c.relname as table_name, c.relkind as kind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v')
     order by c.relname`;

  const columns = await sql`
    select c.table_name, c.column_name, c.udt_name, c.is_nullable, c.column_default,
           c.is_generated, c.identity_generation
      from information_schema.columns c
     where c.table_schema = 'public'
     order by c.table_name, c.ordinal_position`;

  const columnsByTable = new Map();
  for (const col of columns) {
    if (!columnsByTable.has(col.table_name)) columnsByTable.set(col.table_name, []);
    columnsByTable.get(col.table_name).push(col);
  }

  const lines = [];
  lines.push("// GENERATED FILE. Do not edit by hand — run `pnpm db:types`.");
  lines.push("// Produced by scripts/gen-types.mjs (introspection, no Docker — see its header for why).");
  lines.push("");
  lines.push("export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];");
  lines.push("");
  lines.push("export type Database = {");
  lines.push("  public: {");

  lines.push("    Tables: {");
  for (const t of tables.filter((t) => t.kind === "r")) {
    const cols = columnsByTable.get(t.table_name) ?? [];
    lines.push(`      ${t.table_name}: {`);
    lines.push("        Row: {");
    for (const c of cols) {
      const ty = tsType(c.udt_name, enumNames);
      const nullable = c.is_nullable === "YES" ? " | null" : "";
      lines.push(`          ${c.column_name}: ${ty}${nullable};`);
    }
    lines.push("        };");
    lines.push("        Insert: {");
    for (const c of cols) {
      const ty = tsType(c.udt_name, enumNames);
      const optional = c.is_nullable === "YES" || c.column_default !== null || c.is_generated === "ALWAYS";
      const nullable = c.is_nullable === "YES" ? " | null" : "";
      lines.push(`          ${c.column_name}${optional ? "?" : ""}: ${ty}${nullable};`);
    }
    lines.push("        };");
    lines.push("        Update: {");
    for (const c of cols) {
      const ty = tsType(c.udt_name, enumNames);
      const nullable = c.is_nullable === "YES" ? " | null" : "";
      lines.push(`          ${c.column_name}?: ${ty}${nullable};`);
    }
    lines.push("        };");
    lines.push("        Relationships: [];");
    lines.push("      };");
  }
  lines.push("    };");

  lines.push("    Views: {");
  for (const t of tables.filter((t) => t.kind === "v")) {
    const cols = columnsByTable.get(t.table_name) ?? [];
    lines.push(`      ${t.table_name}: {`);
    lines.push("        Row: {");
    for (const c of cols) {
      const ty = tsType(c.udt_name, enumNames);
      lines.push(`          ${c.column_name}: ${ty} | null;`);
    }
    lines.push("        };");
    lines.push("        Relationships: [];");
    lines.push("      };");
  }
  lines.push("    };");

  // Only SECURITY DEFINER functions granted to `authenticated` are callable
  // through the RLS-scoped client — anything else (service_role-only RPCs like
  // rpc_claim_jobs) is deliberately absent here; calling those through this
  // client would fail at the database regardless of what TypeScript allows.
  const functions = await sql`
    select p.proname as name, p.oid::text as oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     order by p.proname`;

  const params = await sql`
    select specific_name, parameter_name, udt_name, ordinal_position, parameter_default
      from information_schema.parameters
     where specific_schema = 'public'
     order by specific_name, ordinal_position`;

  const routines = await sql`
    select specific_name, routine_name, type_udt_name
      from information_schema.routines
     where specific_schema = 'public'`;

  const paramsByRoutine = new Map();
  for (const p of params) {
    if (!paramsByRoutine.has(p.specific_name)) paramsByRoutine.set(p.specific_name, []);
    paramsByRoutine.get(p.specific_name).push(p);
  }
  const routineByName = new Map(routines.map((r) => [r.specific_name, r]));

  lines.push("    Functions: {");
  for (const fn of functions) {
    // information_schema keys routines by "name_oid"; find the matching one.
    const specificName = [...routineByName.keys()].find((k) => k.endsWith(`_${fn.oid}`));
    const routine = specificName ? routineByName.get(specificName) : undefined;
    const fnParams = specificName ? (paramsByRoutine.get(specificName) ?? []) : [];

    lines.push(`      ${fn.name}: {`);
    if (fnParams.length === 0) {
      // {} would allow any non-nullish value (@typescript-eslint/no-empty-object-type).
      lines.push("        Args: Record<string, never>;");
    } else {
      lines.push("        Args: {");
      for (const p of fnParams) {
        const ty = tsType(p.udt_name, enumNames);
        const optional = p.parameter_default !== null;
        lines.push(`          ${p.parameter_name}${optional ? "?" : ""}: ${ty};`);
      }
      lines.push("        };");
    }
    lines.push(`        Returns: ${routine ? tsType(routine.type_udt_name, enumNames) : "unknown"};`);
    lines.push("      };");
  }
  lines.push("    };");

  lines.push("    Enums: {");
  for (const [name, values] of enumsByName) {
    lines.push(`      ${name}: ${values.map((v) => JSON.stringify(v)).join(" | ")};`);
  }
  lines.push("    };");

  lines.push("  };");
  lines.push("};");
  lines.push("");

  writeFileSync("lib/supabase/database.types.ts", lines.join("\n"));
  console.log(
    `✓ lib/supabase/database.types.ts written — ${tables.length} table/view(s), ${enumsByName.size} enum(s)`
  );
} catch (e) {
  console.error("✗ failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
