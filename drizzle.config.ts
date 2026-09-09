import type { Config } from "drizzle-kit";

/**
 * Drizzle generates nothing authoritative.
 *
 * `supabase/migrations/*.sql` is the source of truth for schema
 * (`../AGENTS.md`, database rule 1). Drizzle's job here is typed access for
 * service_role job handlers, generated types, and drift detection — `pnpm
 * db:check-drift` fails CI when db/schema and the migration set disagree.
 *
 * DATABASE_URL authenticates as a privileged role and bypasses RLS, which is
 * why it belongs to migrations and tooling and never to a request path (D11).
 */
export default {
  schema: "./db/schema",
  out: "./supabase/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  },
  verbose: true,
  strict: true,
} satisfies Config;
