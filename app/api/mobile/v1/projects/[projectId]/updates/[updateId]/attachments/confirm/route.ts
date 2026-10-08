import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireProjectAccess, requireRole } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { getBearerToken } from "@/lib/supabase/server";
import { confirmUploadSchema } from "@/features/attachments/schema";
import { confirmUploadFor } from "@/features/attachments/upload";

/**
 * POST /api/mobile/v1/projects/:projectId/updates/:updateId/attachments/confirm
 * — step two: after the app's PUT to R2 succeeded, record the photo. The
 * mobile counterpart of the web's `confirmUpload` action
 * (features/attachments/actions.ts), on the same shared helper
 * (features/attachments/upload.ts): the key re-checked against this project
 * and this update, the object's real size checked in R2 (HeadObject), the
 * `attachments` row inserted, the thumbnail job enqueued.
 *
 * The body carries the `key` from step one and the file's name, type and
 * size; the project, the update and the entity type (`daily_update`) are the
 * server's, never the client's. The database decides the rest
 * (trg_attachments_daily_update): admin/site only, the update's author and
 * project, nobody else's draft, at most four photos — race-safe.
 *
 * Bearer only; admin/site (client → 403); project access (non-member →
 * 403). Returns the new attachment's id — what the app later posts in
 * `attachmentIds` — and nothing about where it is stored.
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; updateId: string }> }
) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    // Real role, from the bearer session; a client stops here (403).
    const session = await requireRole(["admin", "site"]);

    const { projectId, updateId } = await params;
    // Not an id at all: the same answer as a record that does not exist.
    if (!isUuid(projectId) || !isUuid(updateId)) {
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

    // The upload's own facts from the body; where it belongs from the URL.
    const { key, fileName, mimeType, sizeBytes } = body as Record<string, unknown>;
    const parsed = confirmUploadSchema.safeParse({
      key,
      fileName,
      mimeType,
      sizeBytes,
      projectId,
      entityType: "daily_update",
      entityId: updateId,
    });
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const confirmed = await confirmUploadFor(session, parsed.data);
    return NextResponse.json({ id: confirmed.id }, { status: 201, headers: NO_STORE });
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
