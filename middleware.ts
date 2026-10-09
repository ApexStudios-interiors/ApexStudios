import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env.client";
import { isUuid } from "@/lib/routing/slug";
import { PROJECT_PATH_RE } from "@/lib/routing/decide";
import {
  packageIdFromSlug,
  packageSlugFromId,
  projectIdFromSlug,
  projectSlugFromId,
} from "@/lib/routing/resolve";

/**
 * architecture.md §3. Answers exactly one question: "are you signed in?"
 *
 * Authorisation — role, project membership, capability checks — does NOT
 * belong here (build/03-auth-and-rbac.md §2.3). Middleware runs on the edge
 * with a partial view of the request; role decisions belong in
 * lib/auth/session.ts, run from a Server Component or Server Action that can
 * see the full request and hit the database if it needs to.
 */
// D51: /login is the only sign-in route. The magic-link routes (/client-login,
// /auth/callback, /auth/error) are deleted, so they are not public either — an
// old link to one now lands on /login like any other protected path.
const PUBLIC_PATHS = ["/login", "/api/health"];

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

  // Readable project URLs. Only for a signed-in request: every lookup below
  // runs through the caller's own RLS-scoped client, so it cannot be used to
  // discover a project code in another organisation.
  if (user) {
    const routed = await resolveProjectPath(request, supabase);
    if (routed) return routed;
  }

  return response;
}

/** `/projects/<seg>[/packages/<seg>][/rest]` — the only paths this touches.
 *  Shared with lib/routing/decide.ts, which is what the tests assert against,
 *  so the measured behaviour and the real behaviour cannot drift apart. */
const PROJECT_PATH = PROJECT_PATH_RE;

/**
 * Two directions, one matcher:
 *
 *   readable -> ids   REWRITE. The route on disk still receives UUIDs, so
 *                     nothing downstream changes — including every
 *                     `revalidatePath('/projects/<uuid>', 'layout')`, which
 *                     would otherwise be invalidating a path that no longer
 *                     renders.
 *   ids -> readable   REDIRECT, so an old bookmark or a notification link
 *                     (the bell builds its hrefs from UUIDs in the database)
 *                     lands on the clean URL.
 *
 * Anything that does not resolve is left alone rather than 404'd here: the
 * page's own `notFound()` is the right place to say a project does not exist,
 * and a resolver failure must never turn a real page into a dead one.
 */
async function resolveProjectPath(
  request: NextRequest,
  supabase: Parameters<typeof projectIdFromSlug>[0]
): Promise<NextResponse | null> {
  const m = PROJECT_PATH.exec(request.nextUrl.pathname);
  if (!m) return null;
  const [, projectSeg, packageSeg, rest = ""] = m;
  if (!projectSeg) return null;

  const projectIsId = isUuid(projectSeg);
  const packageIsId = packageSeg ? isUuid(packageSeg) : false;
  // Already clean, or already all ids with nothing to translate — the common
  // case, and it costs no query.
  if (!projectIsId && !(packageSeg && packageIsId)) {
    const projectId = await projectIdFromSlug(supabase, projectSeg);
    if (!projectId) return null;
    let target = `/projects/${projectId}`;
    if (packageSeg) {
      const packageId = await packageIdFromSlug(supabase, projectId, packageSeg);
      if (!packageId) return null;
      target += `/packages/${packageId}`;
    }
    const url = request.nextUrl.clone();
    url.pathname = target + rest;
    return NextResponse.rewrite(url);
  }

  if (!projectIsId) return null;

  const slug = await projectSlugFromId(supabase, projectSeg);
  if (!slug) return null;
  let target = `/projects/${slug}`;
  if (packageSeg) {
    const pkgSlug = packageIsId ? await packageSlugFromId(supabase, projectSeg, packageSeg) : packageSeg;
    if (!pkgSlug) return null;
    target += `/packages/${pkgSlug}`;
  }
  const url = request.nextUrl.clone();
  url.pathname = target + rest;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Every route except:
     * - _next/static, _next/image, favicon.ico — build assets, never gated
     * - /api/cron/* — authenticates with Authorization: Bearer CRON_SECRET,
     *   not a session; running the session-refresh dance against a cron
     *   request is pointless and the redirect-to-login would break it outright
     * - /api/backup/report — same Bearer CRON_SECRET auth, called by the
     *   backup.nightly GitHub workflow; without this it was redirected to
     *   /login and the backup outcome was never recorded
     * - /api/mobile/* — authenticates with Authorization: Bearer <user access
     *   token>, not cookies. A cookie-less request would otherwise be 307'd to
     *   the /login page instead of getting a JSON 401. Each route guards itself
     *   with requireSession()/requireRole(), and the mobile app refreshes its
     *   own token, so the session-refresh dance has nothing to do here either
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/cron|api/backup/report|api/mobile/).*)",
  ],
};
