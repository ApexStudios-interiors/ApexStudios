import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env.client";

/**
 * architecture.md §3. Answers exactly one question: "are you signed in?"
 *
 * Authorisation — role, project membership, capability checks — does NOT
 * belong here (build/03-auth-and-rbac.md §2.3). Middleware runs on the edge
 * with a partial view of the request; role decisions belong in
 * lib/auth/session.ts, run from a Server Component or Server Action that can
 * see the full request and hit the database if it needs to.
 */
const PUBLIC_PATHS = ["/login", "/client-login", "/auth/callback", "/auth/error", "/api/health"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID();

  let response = NextResponse.next({
    request: { headers: new Headers(request.headers) },
  });
  response.headers.set("x-request-id", requestId);

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Cookies must be written to BOTH the outgoing request (so this same
          // middleware invocation's downstream server logic sees the refreshed
          // session) and the response (so the browser stores it). @supabase/ssr
          // docs for Next.js middleware: rebuild `response` after mutating the
          // request, or the response is built from a stale request object.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          response.headers.set("x-request-id", requestId);
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // getUser() (not getSession()) — it revalidates against Supabase Auth rather
  // than trusting the JWT's own claims, which is what actually refreshes an
  // expiring token. This is the one round trip that keeps a session alive.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(request.nextUrl.pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Every route except:
     * - _next/static, _next/image, favicon.ico — build assets, never gated
     * - /api/cron/* — authenticates with Authorization: Bearer CRON_SECRET,
     *   not a session; running the session-refresh dance against a cron
     *   request is pointless and the redirect-to-login would break it outright
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/cron).*)",
  ],
};
