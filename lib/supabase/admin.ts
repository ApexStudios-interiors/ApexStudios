import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { clientEnv } from "@/lib/env.client";
import type { Database } from "@/lib/supabase/database.types";

/**
 * ⚠ THIS CLIENT BYPASSES ROW LEVEL SECURITY. ⚠
 *
 * `service_role` is a superuser key. Every RLS policy in supabase/migrations
 * is inert against it — using this anywhere a request can reach it is a full
 * bypass of the product's central promise (a client cannot see internal cost).
 *
 * architecture.md §4.1, this build's own AGENTS.md rule: import-restricted by
 * ESLint (eslint.config.mjs RLS_BYPASS) to exactly two places:
 *   - lib/jobs/handlers/** — background jobs run as service_role by design.
 *   - lib/auth/admin.ts — the ONE place user administration legitimately needs
 *     GoTrue's admin API (auth.admin.createUser, .signOut, .deleteUser), which
 *     has no RLS-scoped equivalent because it is not a Postgres table.
 *
 * Never import this from an action, a query, a component, or a route handler
 * directly. If a feature seems to need it outside those two places, the
 * feature needs an RPC instead, not a bypass.
 */
export function createAdminClient() {
  // NEXT_PUBLIC_SUPABASE_URL is public information (it is in the client
  // bundle) — reading it here is not the RLS bypass; the service_role key is.
  return createSupabaseClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
