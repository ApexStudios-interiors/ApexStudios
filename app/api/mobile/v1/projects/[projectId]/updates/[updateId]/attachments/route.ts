import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireProjectAccess, requireRole } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { getBearerToken } from "@/lib/supabase/server";
import { requestUploadUrlSchema } from "@/features/attachments/schema";
import { requestUploadFor } from "@/features/attachments/upload";

/**
 * POST /api/mobile/v1/projects/:projectId/updates/:updateId/attachments —
 * step one of adding a photo to a daily update: a short-lived signed URL the
 * app PUTs the file to, straight to R2. The mobile counterpart of the web's
 * `requestUploadUrl` action (features/attachments/actions.ts), on the same
 * shared helper (features/attachments/upload.ts):
 *
 *   this route → PUT the file to `url` (Content-Type = mimeType)
 *     → …/attachments/confirm → POST …/updates with the attachment ids
 *
 * `:updateId` is the app's own id for the update it is about to post (the
 * update does not exist yet — the web works the same way). Only the file's
 * name, type and size come from the body; the project, the update and the
 * entity type (`daily_update`) are the server's, never the client's.
 *
 * Bearer only; admin/site (client → 403); project access (non-member →
 * 403). The type and size rules (lib/r2/constraints) and the four-photo
 * count are the helper's; the database's own cap and ownership rules apply
 * again at confirm. Errors map as on every mobile route. The response is the
 * signed URL and the object key confirm needs — no credentials.
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

    // Only the file's own facts are taken from the body; everything that
    // says WHERE the file goes is the URL's and the server's.
    const { fileName, mimeType, sizeBytes } = body as Record<string, unknown>;
    const parsed = requestUploadUrlSchema.safeParse({
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

    const signed = await requestUploadFor(session, parsed.data);
    return NextResponse.json({ url: signed.url, key: signed.key }, { headers: NO_STORE });
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
