import "server-only";
import { NextResponse } from "next/server";
import {
  ForbiddenError,
  UnauthenticatedError,
  requireProjectAccess,
  requireRole,
  requireSession,
} from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { getBearerToken } from "@/lib/supabase/server";
import { requestApprovalSchema } from "@/features/approvals/schema";
import { requestApprovalFor } from "@/features/approvals/create";
import {
  countPendingApprovalsByProject,
  getApprovalsForProject,
  getApprovalsPage,
  type ApprovalDTO,
} from "@/features/approvals/queries";
import type { ApprovalStatus } from "@/features/approvals/service";
import { PAGE_SIZE_OPTIONS } from "@/lib/pagination";
import { can } from "@/lib/rbac/permissions";

/**
 * GET — the project's approvals with what this user may do (see GET below).
 *
 * POST /api/mobile/v1/projects/:projectId/approvals — an admin or site
 * supervisor asks the client to approve something on a project they belong
 * to (a material sample, a drawing, a make/model, a milestone…), or raises
 * the revised one for a rejected approval (`supersedesId`). The mobile
 * counterpart of the web's `requestApproval` action
 * (features/approvals/actions.ts): same schema, same shared helper
 * (features/approvals/create.ts), so web and mobile behave identically.
 *
 *   body: { id?, packageId, type, item, phaseId?, note?, neededBy?, supersedesId? }
 *
 * Only those fields are read from the body. The URL's project id is
 * authoritative. `id` is the app's own, chosen once per form, so a retried
 * request (a lost response, a second tap) repeats it: the primary key then
 * refuses a second approval — ILLEGAL_TRANSITION 409, "already requested" —
 * exactly as the web dialog's own once-per-dialog id does. Without one, a
 * fresh id is generated here, as before. `attachmentIds` is refused unless
 * absent or empty.
 *
 * Bearer only. createClient()/getSession() would also accept a browser's
 * session cookie, so this mutation refuses any request without an
 * `Authorization: Bearer` header first — a cookie can never authorize it.
 * middleware.ts skips /api/mobile/*, so the route is its own guard:
 * requireRole (client → 403) and requireProjectAccess (non-member → 403).
 *
 * Every real rule is rpc_create_approval's — membership, role, the item, and
 * supersession (the revised approval must be this project's: NOT_FOUND 404;
 * rejected and not yet revised: ILLEGAL_TRANSITION 409) — plus, once
 * applied, trg_approvals_check_ancestry (package/phase in this project:
 * NOT_FOUND 404). The answer is `{ id, projectId, status, refNo }` only.
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

/**
 * GET /api/mobile/v1/projects/:projectId/approvals — every approval on the
 * project, newest first, as the web's Approvals page reads them
 * (getApprovalsForProject): ref, type, item, package/phase, status, who asked
 * and when, the decision and its reason, the revision links both ways, and
 * the sample photos (short-lived presigned URLs). For any member — admin,
 * site or client (approvals carry no money).
 *
 * Each approval also says what THIS user may do with it, decided here
 * exactly as the web's ApprovalTable does — `can(role, capability)` and the
 * row's own status flag — so the app never works it out:
 *   canDecide     — decideApproval (client) and still pending
 *   canAddPhotos  — addSamplePhotos (admin/site) and still pending
 *   canSupersede  — requestApproval (admin/site), rejected, not yet revised
 * and, for the whole list, `canRequest` — requestApproval (admin/site): may
 * raise a new one.
 * None is enforcement: the decision RPC, the attachments freeze and
 * rpc_create_approval decide every action.
 *
 * Paged (the Approvals screen): with `?page=N` and/or `?status=pending|
 * approved|rejected`, one page of the web Approvals table's own query
 * (getApprovalsPage — filtered and paged in the database), newest first, and
 * the project's pending count (countPendingApprovalsByProject, the sidebar
 * badge's own count) — plus `total`, `page`, `pageSize`, `hasMore`. Without
 * either parameter the answer is the whole list as before
 * (getApprovalsForProject), which the approval screen and the revised-
 * approval form still look an approval up in. A bad `page` or `status` is
 * 400.
 *
 * Bearer only (no cookie), project access as every mobile route.
 */

const STATUSES: readonly ApprovalStatus[] = ["pending", "approved", "rejected"];

/** One of the web table's own page sizes (lib/pagination), fixed. */
const PAGE_SIZE: (typeof PAGE_SIZE_OPTIONS)[number] = 25;
/** Far past any real project's approval count; a bigger page is refused. */
const MAX_PAGE = 1000;
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    const session = await requireSession();

    const { projectId } = await params;
    // Not an id at all: the same answer as a project that does not exist.
    if (!isUuid(projectId)) {
      return errorResponse(404, "NOT_FOUND", mapDomainError(new Error("NOT_FOUND")));
    }

    const query = new URL(request.url).searchParams;
    const rawStatus = query.get("status");
    if (rawStatus !== null && !STATUSES.includes(rawStatus as ApprovalStatus)) {
      return errorResponse(400, "VALIDATION", `status must be one of: ${STATUSES.join(", ")}.`);
    }
    const rawPage = query.get("page");
    if (rawPage !== null && !(/^\d+$/.test(rawPage) && Number(rawPage) >= 1 && Number(rawPage) <= MAX_PAGE)) {
      return errorResponse(400, "VALIDATION", `page must be a whole number from 1 to ${MAX_PAGE}.`);
    }
    const paged = rawStatus !== null || rawPage !== null;

    // Admin passes implicitly; site and client need a project_members row.
    await requireProjectAccess(session, projectId);

    const mayDecide = can(session.role, "decideApproval");
    const mayAddPhotos = can(session.role, "addSamplePhotos");
    const mayRequest = can(session.role, "requestApproval");

    const toMobile = (a: ApprovalDTO) => ({
      id: a.id,
      refNo: a.refNo,
      packageId: a.packageId,
      packageName: a.packageName,
      packageSeqNo: a.packageSeqNo,
      phaseId: a.phaseId,
      phaseName: a.phaseName,
      type: a.type,
      item: a.item,
      note: a.note,
      neededBy: a.neededBy,
      status: a.status,
      requestedByName: a.requestedByName,
      requestedAt: a.requestedAt,
      decidedByName: a.decidedByName,
      decidedAt: a.decidedAt,
      decisionReason: a.decisionReason,
      supersedesId: a.supersedesId,
      supersedesRefNo: a.supersedesRefNo,
      supersededById: a.supersededById,
      supersededByRefNo: a.supersededByRefNo,
      attachments: a.attachments,
      canDecide: mayDecide && a.canDecide,
      canAddPhotos: mayAddPhotos && a.canAddPhotos,
      canSupersede: mayRequest && a.canSupersede,
    });

    if (!paged) {
      const rows = await getApprovalsForProject(session, projectId);
      return NextResponse.json(
        // The session's real role — the only role the app branches on.
        { role: session.role, canRequest: mayRequest, approvals: rows.map(toMobile) },
        { headers: NO_STORE }
      );
    }

    const status = (rawStatus ?? undefined) as ApprovalStatus | undefined;
    const [page, pendingByProject] = await Promise.all([
      getApprovalsPage(session, projectId, status ? { status } : {}, {
        page: rawPage === null ? 1 : Number(rawPage),
        pageSize: PAGE_SIZE,
      }),
      countPendingApprovalsByProject([projectId]),
    ]);
    return NextResponse.json(
      {
        role: session.role,
        canRequest: mayRequest,
        approvals: page.rows.map(toMobile),
        pendingCount: pendingByProject[projectId] ?? 0,
        total: page.total,
        page: page.page,
        pageSize: page.pageSize,
        hasMore: page.page * page.pageSize < page.total,
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

    const { id, packageId, type, item, phaseId, note, neededBy, supersedesId, attachmentIds } =
      body as Record<string, unknown>;
    // Sample photos are not part of the app's flow yet: refuse rather than
    // ignore, so a client that sends them learns they were not attached.
    if (attachmentIds !== undefined && !(Array.isArray(attachmentIds) && attachmentIds.length === 0)) {
      return errorResponse(400, "VALIDATION", "Photos can't be attached to an approval from the app yet.");
    }

    // The app's own id (chosen once per form, so a retry repeats it and meets
    // the primary key — 409, never a second approval) or, when none is sent,
    // a fresh one; the URL's project joins the body's own fields, so
    // requestApprovalSchema — the web action's own schema — stays the single
    // source of truth for the input (the id must be a uuid).
    const parsed = requestApprovalSchema.safeParse({
      id: id === undefined ? crypto.randomUUID() : id,
      projectId,
      packageId,
      type,
      item,
      phaseId,
      note,
      neededBy,
      supersedesId,
      attachmentIds: [],
    });
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const created = await requestApprovalFor(session, parsed.data);
    return NextResponse.json(
      { id: created.id, projectId: created.projectId, status: created.status, refNo: created.refNo },
      { status: 201, headers: NO_STORE }
    );
  } catch (e) {
    return mapError(e);
  }
}
