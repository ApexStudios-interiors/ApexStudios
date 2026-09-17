"use client";

import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env.client";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The browser-side Supabase client. Anon key, RLS applies as the signed-in
 * user — same as lib/supabase/server.ts, different transport.
 *
 * architecture.md §4.1: for Client Components that need realtime or the auth
 * UI's own client-side calls only. Data for
 * rendering comes from a Server Component via props (code-standards §3:
 * "Never fetch in a Client Component"), not by calling this from a component
 * that could instead be a Server Component reading lib/supabase/server.ts.
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
