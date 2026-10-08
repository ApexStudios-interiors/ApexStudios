import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { clientEnv } from "@/lib/env.client";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Found live: a project created by a Server Action, then read on the very next
 * request (the redirect after creating it), came back as "not found" —
 * reproducible only inside Next.js, not against Postgres/PostgREST directly.
 * Next.js patches the global `fetch` its App Router runtime uses to add its
 * own Data Cache, defaulting to `force-cache` for a fetch made during
 * rendering; supabase-js's default fetch is that same patched global, so every
 * PostgREST request this client makes was silently eligible for Next's cache
 * despite this being a per-request, RLS-scoped client with no business ever
 * serving a cached response across requests. Explicit `cache: "no-store"` opts
 * every request out — for both the cookie and the bearer client below.
 */
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store" });

/**
 * The access token from an `Authorization: Bearer <token>` request header, or
 * null. This is how the mobile app authenticates (app/api/mobile/**): it holds
 * its own Supabase session and sends the access token, with no cookies.
 *
 * A browser never sends this header on its own, so a normal web request always
 * takes the cookie path. The token is NOT trusted here — getSession() verifies
 * it with getClaims(token), and PostgREST verifies it again on every query.
 */
export async function getBearerToken(): Promise<string | null> {
  const authorization = (await headers()).get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

/**
 * The Supabase client bound to the signed-in user's JWT, read from cookies —
 * or, for a request carrying `Authorization: Bearer <token>`, from that header.
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
  const bearerToken = await getBearerToken();
  if (bearerToken) return createBearerClient(bearerToken);

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
      global: { fetch: noStoreFetch },
    }
  );
}

/**
 * The bearer-token variant. Same anon key, same RLS: supabase-js sends a
 * `global.headers.Authorization` in place of its own session token, so
 * PostgREST runs every query as `authenticated` with this token's claims.
 *
 * Built with the same createServerClient as the cookie client so callers get
 * the identical client type. It has no cookie store: there is no session to
 * persist or refresh here — the mobile app refreshes its own token.
 */
function createBearerClient(token: string) {
  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
      global: { fetch: noStoreFetch, headers: { Authorization: `Bearer ${token}` } },
    }
  );
}
