import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireProjectAccess, requireRole } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { getBearerToken } from "@/lib/supabase/server";
import { createStockRequestSchema } from "@/features/stock/schema";
import { createStockRequestFor } from "@/features/stock/create";
import {
  countPendingRequestsByProject,
  getStockRequestsPage,
  type StockRequestDTO,
} from "@/features/stock/queries";
import { availableTransitions, isDeadlineAtRisk, type StockRequestStatus } from "@/features/stock/service";
import { PAGE_SIZE_OPTIONS } from "@/lib/pagination";
import { todayIst } from "@/lib/dates";

/**
 * GET — the project's stock requests, one page at a time (see GET below).
 *
 * POST /api/mobile/v1/projects/:projectId/stock-requests — an admin or site
 * supervisor raises a stock request on a project they belong to. The mobile
 * counterpart of the web's `createStockRequest` action
 * (features/stock/actions.ts): same schema, same shared write path
 * (features/stock/create.ts — the D55 rate rule and `rpc_create_stock_request`),
 * so web and mobile behave identically.
 *
 * Bearer only. createClient()/getSession() would also accept a browser's
 * session cookie, so this mutation refuses any request without an
 * `Authorization: Bearer` header first — a cookie can never authorize it.
 * middleware.ts skips /api/mobile/*, so the route is its own guard:
 * requireRole (client → 403) and requireProjectAccess (non-member → 403)
 * before anything is written.
 *
 * The URL's project id is authoritative: it replaces any `projectId` in the
 * body before validation. Every real rule — membership, role, material,
 * quantity, the rate rule again, package/phase ancestry — is the RPC's (and
 * its trigger's); errors map to statuses from their domain code, with
 * mapDomainError's own copy. No web cache refresh is copied.
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

function mapError(e: unknown) {
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

const STATUSES: readonly StockRequestStatus[] = ["pending", "approved", "ordered", "delivered", "rejected"];

/** One of the web table's own page sizes (lib/pagination PAGE_SIZE_OPTIONS:
 *  10 / 25 / 50) — fixed, never the client's: enough rows per "Load more" on
 *  a phone without sending more than a screen needs. */
const PAGE_SIZE: (typeof PAGE_SIZE_OPTIONS)[number] = 25;
/** Far past any real project's request count; a bigger page is refused. */
const MAX_PAGE = 1000;

/**
 * GET /api/mobile/v1/projects/:projectId/stock-requests — the web's Stock
 * Requests page (app/(app)/projects/[projectId]/stock/page.tsx) as data: one
 * page of the project's requests, newest-deadline-first exactly as the web
 * table orders them, optionally filtered by `status` and `packageId`.
 *
 *   ?status=pending|approved|ordered|delivered|rejected   (omitted: all)
 *   ?packageId=<uuid>                                     (omitted: all)
 *   ?page=1,2,…                                           (omitted: 1)
 *
 * Bearer only; admin and site; a client is refused (403) as the web page
 * refuses one (`forbidden()`), never shown an empty list. Project access as
 * every mobile route.
 *
 * Rows are getStockRequestsPage's own role-shaped DTOs: an admin's read the
 * base table (rate, value); a site supervisor's read v_stock_request_site,
 * which has no rate at all. The route passes `rate` and `value` on for an
 * admin only — the keys are absent for anyone else. The package filter is
 * applied inside that query, which is always scoped to this project, so a
 * package from another project simply matches nothing.
 *
 * Each row also carries what the server decides for the UI:
 *   actions — availableTransitions(status, role): the target statuses this
 *             user may move the request to (the buttons the web shows);
 *   atRisk  — isDeadlineAtRisk(status, neededBy, todayIst()): the web's red
 *             needed-by date.
 * Neither is enforcement: rpc_transition_stock_request decides every move.
 *
 * `pendingCount` is the project's pending requests
 * (countPendingRequestsByProject), not a count of this page. `page` is the
 * page actually returned (the query falls back to the last page that has rows
 * if asked past the end); `hasMore` says whether a next page exists.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    // Real role, from the bearer session; a client stops here (403).
    const session = await requireRole(["admin", "site"]);

    const { projectId } = await params;
    // Not an id at all: the same answer as a project that does not exist.
    if (!isUuid(projectId)) {
      return errorResponse(404, "NOT_FOUND", mapDomainError(new Error("NOT_FOUND")));
    }

    const query = new URL(request.url).searchParams;
    const rawStatus = query.get("status");
    if (rawStatus !== null && !STATUSES.includes(rawStatus as StockRequestStatus)) {
      return errorResponse(400, "VALIDATION", `status must be one of: ${STATUSES.join(", ")}.`);
    }
    const status = (rawStatus ?? undefined) as StockRequestStatus | undefined;
    const rawPackageId = query.get("packageId");
    if (rawPackageId !== null && !isUuid(rawPackageId)) {
      return errorResponse(400, "VALIDATION", "packageId must be a valid id.");
    }
    const packageId = rawPackageId ?? undefined;
    const rawPage = query.get("page");
    if (rawPage !== null && !(/^\d+$/.test(rawPage) && Number(rawPage) >= 1 && Number(rawPage) <= MAX_PAGE)) {
      return errorResponse(400, "VALIDATION", `page must be a whole number from 1 to ${MAX_PAGE}.`);
    }
    const page = rawPage === null ? 1 : Number(rawPage);

    // Admin passes implicitly; site needs a project_members row (403).
    await requireProjectAccess(session, projectId);

    const [result, pendingByProject] = await Promise.all([
      getStockRequestsPage(session, projectId, { status, packageId }, { page, pageSize: PAGE_SIZE }),
      countPendingRequestsByProject(session, [projectId]),
    ]);

    const isAdmin = session.role === "admin";
    const today = todayIst();
    const toMobile = (r: StockRequestDTO) => ({
      id: r.id,
      refNo: r.refNo,
      projectId: r.projectId,
      packageId: r.packageId,
      packageName: r.packageName,
      materialName: r.materialName,
      qty: r.qty,
      unit: r.unit,
      // Admin money: the keys exist only for an admin.
      ...(isAdmin ? { rate: r.rate, value: r.value } : {}),
      neededBy: r.neededBy,
      note: r.note,
      status: r.status,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt,
      approvedAt: r.approvedAt,
      orderedAt: r.orderedAt,
      deliveredAt: r.deliveredAt,
      rejectedReason: r.rejectedReason,
      actions: availableTransitions(r.status, session.role).map((t) => t.to),
      atRisk: isDeadlineAtRisk(r.status, r.neededBy, today),
    });

    return NextResponse.json(
      {
        // The session's real role — the only role the app branches on.
        role: session.role,
        requests: result.rows.map(toMobile),
        total: result.total,
        pendingCount: pendingByProject[projectId] ?? 0,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.page * result.pageSize < result.total,
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    return mapError(e);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "VALIDATION", "Request body must be valid JSON.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return errorResponse(400, "VALIDATION", "Request body must be a JSON object.");
    }

    // The URL's project id joins (and overrides) the body, so
    // createStockRequestSchema — the web action's own schema — stays the
    // single source of truth for the input.
    const parsed = createStockRequestSchema.safeParse({ ...body, projectId });
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const created = await createStockRequestFor(session, parsed.data);
    return NextResponse.json({ id: created.id, refNo: created.refNo }, { status: 201, headers: NO_STORE });
  } catch (e) {
    return mapError(e);
  }
}
