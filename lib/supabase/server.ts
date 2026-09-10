import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientEnv } from "@/lib/env.client";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The Supabase client bound to the signed-in user's JWT, read from cookies.
 * RLS applies automatically because PostgREST runs every query as
 * `authenticated` with the user's claims (D11 — docs/decisions.md).
 *
 * This is the ONLY client user-facing Server Components and Server Actions may
 * use. Never lib/supabase/admin.ts, never a direct Drizzle/Postgres connection.
 *
 * Next.js's `cookies()` is async in the App Router; `createServerClient`'s
 * `getAll`/`setAll` are called synchronously by @supabase/ssr internally, so
 * the cookie store is resolved once, up front, per call.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which cannot set cookies. Safe to
            // ignore here because middleware.ts refreshes the session and writes
            // cookies on every request already — this path only matters for
            // Server Actions and Route Handlers, which CAN set cookies.
          }
        },
      },
    }
  );
}
