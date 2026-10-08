import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireSession } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { getBearerToken } from "@/lib/supabase/server";
import { searchAllSchema } from "@/features/search/schema";
import { searchFor } from "@/features/search/run";
import type { SearchResultDTO } from "@/features/search/service";

/**
 * GET /api/mobile/v1/search?q=<text> — the web header's global search
 * (components/layout/SearchBar.tsx → features/search/actions.ts searchAll),
 * for the app: the same shared runner (features/search/run.ts — the 20/min
 * rate limit, then queries.ts's role-scoped searches, capped at 5 a category
 * and 25 in all, in the web's category order).
 *
 * What a user can find is decided by THEIR session only: each category is
 * its own role-scoped query (the views the rest of the app reads), and a
 * category a role may not see is never queried at all — a client never
 * searches stock requests or inventory, site never searches bills, only an
 * admin searches users. Nothing about the caller is taken from the request.
 *
 * `q` is trimmed. Fewer than two characters (the web schema's own minimum)
 * is not a search: `{ results: [] }`, without touching the database or the
 * rate limit. Each result is what the app needs to show and open it:
 *   { type, id, title, subtitle, projectId }
 * `type` is the web's own category name ("Projects", "Stock Requests", …);
 * the web's `href` is a web path and is not sent.
 *
 * Bearer only; any signed-in role. Errors map as on every mobile route; the
 * rate limit is 429.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** HTTP status for each domain code this route can meet. Anything else is
 *  an unexpected failure: 500. */
const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
};

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    const session = await requireSession();

    const raw = new URL(request.url).searchParams.get("q") ?? "";
    const parsed = searchAllSchema.safeParse({ query: raw });
    // Empty, whitespace or a single character: nothing to search yet.
    if (!parsed.success) return NextResponse.json({ results: [] }, { headers: NO_STORE });

    const found = await searchFor(session, parsed.data.query);
    const toMobile = (r: SearchResultDTO) => ({
      type: r.category,
      id: r.id,
      title: r.text,
      subtitle: r.sub,
      projectId: r.projectId,
    });
    return NextResponse.json({ results: found.map(toMobile) }, { headers: NO_STORE });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const code =
      err instanceof UnauthenticatedError
        ? "UNAUTHENTICATED"
        : err instanceof ForbiddenError
          ? "FORBIDDEN"
          : codeFromPostgresMessage(err.message);
    const status = code ? STATUS_BY_CODE[code] : undefined;
    // mapDomainError owns the user-facing copy (and logs an unmapped error
    // with the reference it returns); a raw database message never leaves.
    const message = mapDomainError(err);
    if (code && status) return errorResponse(status, code, message);
    return errorResponse(500, "INTERNAL", message);
  }
}
