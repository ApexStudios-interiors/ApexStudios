import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * ⚠ THIS CONNECTION BYPASSES ROW LEVEL SECURITY. ⚠
 *
 * It authenticates over DATABASE_URL as a privileged database role, so every
 * policy in 02-lld.md §6 is inert on it. That is not a bug to fix here; it is
 * why its use is confined.
 *
 * D11 (docs/decisions.md), and it is a hard rule:
 *
 *   User-facing reads, writes and rpc_* calls go through the Supabase server
 *   client bound to the user's JWT (lib/supabase/server). PostgREST runs those
 *   as `authenticated` with the user's claims, so RLS applies automatically.
 *
 *   This module is for schema definition, migration generation, generated types,
 *   and queries inside lib/jobs/handlers/** that legitimately run as
 *   service_role.
 *
 *   A Drizzle query in a request path is an RLS bypass and is a blocking review
 *   comment. An ESLint rule restricts `drizzle-orm`, `postgres` and `@/db`
 *   imports to db/** and lib/jobs/handlers/**, so the restriction is mechanical
 *   rather than cultural.
 *
 * supabase/migrations/*.sql remains the source of truth for schema (AGENTS.md
 * database rule 1). `pnpm db:check-drift` fails CI when db/schema and the
 * migration set disagree, because generated types that lie are worse than no
 * types at all.
 */
const client = postgres(env.DATABASE_URL, { max: 1, prepare: false });

export const db = drizzle(client, { schema });
export { schema };
