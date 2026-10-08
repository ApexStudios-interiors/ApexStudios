import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireRole } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { getBearerToken } from "@/lib/supabase/server";
import { transitionStockRequestSchema } from "@/features/stock/schema";
import { transitionStockRequestFor } from "@/features/stock/transition";

/**
 * POST /api/mobile/v1/stock-requests/:requestId/transition — move a stock
 * request along its workflow: approve or reject it (admin), mark it ordered
 * (admin), mark it delivered (admin or site). The mobile counterpart of the
 * web's `transitionStockRequest` action (features/stock/actions.ts): same
 * schema, same shared helper (features/stock/transition.ts), so web and
 * mobile behave identically.
 *
 *   body: { "toStatus": "approved" | "rejected" | "ordered" | "delivered",
 *           "note"?: string }        — a rejection's reason is its note
 *
 * Bearer only. createClient()/getSession() would also accept a browser's
 * session cookie, so this mutation refuses any request without an
 * `Authorization: Bearer` header first — a cookie can never authorize it.
 * middleware.ts skips /api/mobile/*, so the route is its own guard:
 * requireRole matches the web action's (admin/site; client → 403).
 *
 * Every real rule is rpc_transition_stock_request's: which moves are legal
 * (else ILLEGAL_TRANSITION, 409), who may make each (FORBIDDEN, 403),
 * project membership (403), the rejection reason (REASON_REQUIRED, 422), the
 * row lock, the stock movement on delivery, the event and the audit. Nothing
 * is re-decided here. The answer is `{ id, status }` only — never the row,
 * so no rate, value or billing field. No web cache refresh is copied.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** HTTP status for each domain code this route can meet. Anything else is
 *  an unexpected failure: 500. Same table as the other mobile mutations. */
const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ILLEGAL_TRANSITION: 409,
  REASON_REQUIRED: 422,
};

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: NO_STORE });
}

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    // Real role, from the bearer session; a client stops here (403).
    const session = await requireRole(["admin", "site"]);

    const { requestId } = await params;
    // Not an id at all: the same answer as a request that does not exist.
    if (!isUuid(requestId)) {
      return errorResponse(404, "NOT_FOUND", mapDomainError(new Error("NOT_FOUND")));
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "VALIDATION", "Request body must be valid JSON.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return errorResponse(400, "VALIDATION", "Request body must be a JSON object.");
    }

    // The URL's id joins (and overrides) the body, so
    // transitionStockRequestSchema — the web action's own schema — stays the
    // single source of truth: toStatus one of the four targets, note
    // optional and trimmed.
    const { toStatus, note } = body as { toStatus?: unknown; note?: unknown };
    const parsed = transitionStockRequestSchema.safeParse({ requestId, toStatus, note });
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const moved = await transitionStockRequestFor(session, parsed.data);
    return NextResponse.json({ id: moved.id, status: moved.status }, { headers: NO_STORE });
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
