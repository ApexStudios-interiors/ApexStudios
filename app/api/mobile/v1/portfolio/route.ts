import "server-only";
import { NextResponse } from "next/server";
import { NO_STORE, mobileErrorFrom, requireBearerSession } from "@/lib/mobile/api";
import { getPortfolio } from "@/features/projects/queries";

/**
 * GET /api/mobile/v1/portfolio — the signed-in user's projects and stat row,
 * exactly what the web's All Projects page renders (app/(app)/page.tsx).
 *
 * Authenticates with `Authorization: Bearer <Supabase access token>` (D67);
 * middleware.ts skips /api/mobile/*, so this route is its own guard. Every
 * role may call it. The body is getPortfolio()'s result, unchanged: it is
 * already role-shaped — admin's financial fields, a client's contract value
 * only, no money at all for site — and RLS scopes the projects to the
 * caller's memberships. Nothing is added or recomputed here.
 *
 * The top-level `role` is the authenticated session's role — `admin`, `site`
 * or `client` — and is what the app should branch on. `portfolio.role` is
 * getPortfolio's own variant tag (admin's is "money"), not a user role.
 *
 * Bearer only (lib/mobile/api.ts requireBearerSession): a request without an
 * `Authorization: Bearer` header is refused before anything else, so a
 * browser's session cookie can never authorize it. Errors are
 * `{ error, message }`, as on every other mobile route.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireBearerSession();
    const portfolio = await getPortfolio(session);
    return NextResponse.json({ role: session.role, portfolio }, { headers: NO_STORE });
  } catch (e) {
    // { error, message } with mapDomainError's copy (lib/mobile/api.ts): a raw
    // Postgres message never leaves the server; the log gets it, tagged with
    // the reference the caller sees.
    return mobileErrorFrom(e);
  }
}
