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
import { postDailyUpdateSchema } from "@/features/updates/schema";
import { getUpdatesForProject, isValidUpdatesCursor } from "@/features/updates/queries";
import { postDailyUpdateFor } from "@/features/updates/write";

/**
 * /api/mobile/v1/projects/:projectId/updates — a project's daily updates.
 *
 * GET: the newest page of updates, exactly as the web's Daily Updates page
 * reads them (getUpdatesForProject — newest first, its own page size, photo
 * URLs short-lived and presigned), for any member: admin, site or client.
 * One page at a time (the query's own page size), newest first:
 *   ?packageId=<uuid>  only that package's updates (the web's package filter)
 *   ?cursor=<token>    the next, older page — the `nextCursor` of the last
 * `hasMore` and `nextCursor` say whether, and how, to ask for the next page.
 * A malformed package id or a cursor the query never issued is 400.
 *
 * POST: an admin or site supervisor posts a daily update on a project they
 * belong to. The mobile counterpart of the web's `postDailyUpdate` action
 * (features/updates/actions.ts): same schema, same shared write path
 * (features/updates/write.ts), so web and mobile behave identically.
 *
 * The update's id, as on the web, is chosen by the client up front: photos
 * are uploaded and confirmed against it (…/updates/:updateId/attachments)
 * before the update exists, then posted here with `attachmentIds`. `id` is
 * optional only for a text-only post, which gets a fresh server id; posting
 * photos without the id they were uploaded for is refused (400).
 * postDailyUpdateFor re-checks every photo is this user's, for this project
 * and id; the database refuses an id carrying someone else's photos
 * (trg_daily_updates_photos). Posting an id that already exists — a retry
 * after a lost response — is ILLEGAL_TRANSITION (409), never a second update.
 *
 * Bearer only. createClient()/getSession() would also accept a browser's
 * session cookie, so both methods refuse any request without an
 * `Authorization: Bearer` header first — a cookie can never authorize them.
 * middleware.ts skips /api/mobile/*, so the route is its own guard:
 * requireRole (POST: client → 403) and requireProjectAccess (non-member →
 * 403) before anything is read or written.
 *
 * The URL's project id is authoritative: it replaces any `projectId` in the
 * body before validation. Every real rule — membership, role, author, org,
 * the package belonging to the project — is the database's (du_insert,
 * trg_daily_updates_ancestry); errors map to statuses from their domain
 * code, with mapDomainError's own copy. No web cache refresh is copied.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** HTTP status for each domain code this route can meet. Anything else is
 *  an unexpected failure: 500. Same table as the other mobile routes. */
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

/** Far longer than any cursor the query issues (base64url of three short
 *  fields); a longer value is not one. */
const MAX_CURSOR_LENGTH = 512;

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    const session = await requireSession();

    const { projectId } = await params;
    // Not an id at all: the same answer as a project that does not exist.
    if (!isUuid(projectId)) {
      return errorResponse(404, "NOT_FOUND", mapDomainError(new Error("NOT_FOUND")));
    }

    // The web Updates page's own two options, passed straight to its query.
    const query = new URL(request.url).searchParams;
    const rawPackageId = query.get("packageId");
    if (rawPackageId !== null && !isUuid(rawPackageId)) {
      return errorResponse(400, "VALIDATION", "packageId must be a valid id.");
    }
    const rawCursor = query.get("cursor");
    if (rawCursor !== null && (rawCursor.length > MAX_CURSOR_LENGTH || !isValidUpdatesCursor(rawCursor))) {
      return errorResponse(400, "VALIDATION", "cursor is not valid.");
    }

    // Admin passes implicitly; site and client need a project_members row.
    await requireProjectAccess(session, projectId);

    // The query filters by THIS project before the package, so a package of
    // another project simply matches nothing.
    const page = await getUpdatesForProject(session, projectId, {
      packageId: rawPackageId ?? undefined,
      cursor: rawCursor ?? undefined,
    });

    return NextResponse.json(
      {
        // The session's real role — the only role the app branches on.
        role: session.role,
        // Each update as the query shaped it, minus authorId: the app shows
        // the author's name and reads `canEdit` (the query's own author +
        // 24-hour check) instead of comparing ids itself.
        updates: page.items.map((u) => ({
          id: u.id,
          packageId: u.packageId,
          packageName: u.packageName,
          packageSeqNo: u.packageSeqNo,
          updateDate: u.updateDate,
          body: u.body,
          authorName: u.authorName,
          createdAt: u.createdAt,
          canEdit: u.canEdit,
          attachments: u.attachments,
        })),
        hasMore: page.nextCursor !== null,
        // The query's own cursor for the next (older) page; null on the last.
        nextCursor: page.nextCursor,
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

    // Photos are confirmed against the client's id before this call, so a
    // photo post must name that id; only a text-only post may omit it.
    const { id, attachmentIds } = body as { id?: unknown; attachmentIds?: unknown };
    const hasPhotos = !(
      attachmentIds === undefined ||
      (Array.isArray(attachmentIds) && attachmentIds.length === 0)
    );
    if (id === undefined && hasPhotos) {
      return errorResponse(
        400,
        "VALIDATION",
        "An update with photos needs the id its photos were uploaded for."
      );
    }

    // The URL's project id (always) and a fresh id (text-only, no id sent)
    // join the body, so postDailyUpdateSchema — the web action's own schema —
    // stays the single source of truth: `id` a uuid, `attachmentIds` at most
    // four uuids.
    const parsed = postDailyUpdateSchema.safeParse({
      ...body,
      id: id === undefined ? crypto.randomUUID() : id,
      projectId,
    });
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const posted = await postDailyUpdateFor(session, parsed.data);
    return NextResponse.json({ id: posted.id }, { status: 201, headers: NO_STORE });
  } catch (e) {
    return mapError(e);
  }
}
