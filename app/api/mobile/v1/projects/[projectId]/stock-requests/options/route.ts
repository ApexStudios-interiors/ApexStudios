import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireProjectAccess, requireRole } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { getBearerToken } from "@/lib/supabase/server";
import { getMaterialSuggestions, getUnitOptions } from "@/features/stock/actions";
import { getProjectRateVisibility } from "@/features/projects/actions";

/**
 * GET /api/mobile/v1/projects/:projectId/stock-requests/options — what the
 * mobile New Stock Request form needs and the project endpoint does not
 * carry: the unit list, the project's rate visibility (D55) and the
 * Material field's suggestions.
 *
 * Read-only, but Bearer only like the mutation it serves: middleware.ts
 * skips /api/mobile/*, so the route is its own guard — admin/site only
 * (client → 403), project access required (non-member → 403).
 *
 * The data comes from the web dialog's own helpers, unchanged:
 * `getUnitOptions` (units in display order, `code` + `label` — what the
 * picker needs) and `getProjectRateVisibility`. The web reads the rate
 * visibility for any signed-in member ("every role may read it",
 * features/projects/queries.ts), so returning it here widens nothing. The
 * app uses it only to decide whether to show the Rate field, exactly as
 * NewRequestDialog does (admin always; site per siteMaySeeRateField /
 * siteMayEnterRate). The server's D55 rule stays authoritative on create.
 * `getMaterialSuggestions` is the web dialog's own Material suggestion list
 * (the org's inventory item names, through the user's RLS-scoped client —
 * names only, no money); suggestions only, the field stays free text.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** HTTP status for each domain code this route can meet. Anything else is
 *  an unexpected failure: 500. Same table as the other mobile routes. */
const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
};

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: NO_STORE });
}

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    // Real role, from the bearer session; a client stops here (403).
    const session = await requireRole(["admin", "site"]);

    const { projectId } = await params;
    // Not an id at all: the same answer as a project that does not exist.
    if (!isUuid(projectId)) {
      return errorResponse(404, "NOT_FOUND", mapDomainError(new Error("NOT_FOUND")));
    }
    // Admin passes implicitly; site needs a project_members row (403).
    await requireProjectAccess(session, projectId);

    const [units, rateVisibility, materials] = await Promise.all([
      getUnitOptions(),
      getProjectRateVisibility(projectId),
      getMaterialSuggestions(),
    ]);

    return NextResponse.json(
      {
        rateVisibility,
        units: units.map((u) => ({ code: u.code, label: u.label })),
        materials,
      },
      { headers: NO_STORE }
    );
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
