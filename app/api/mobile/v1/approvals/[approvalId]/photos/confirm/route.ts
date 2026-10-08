import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireProjectAccess, requireRole } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { getBearerToken } from "@/lib/supabase/server";
import { confirmUploadSchema } from "@/features/attachments/schema";
import { confirmUploadFor } from "@/features/attachments/upload";
import { approvalForPhotos } from "@/features/approvals/photos";

/**
 * POST /api/mobile/v1/approvals/:approvalId/photos/confirm — step two: after
 * the app's PUT to R2 succeeded, record the photo against the approval. The
 * mobile counterpart of the web's confirmUpload, on the same shared helper
 * (features/attachments/upload.ts): the key re-checked against this project
 * and this approval, the object's real size checked in R2, the `attachments`
 * row inserted (which is what puts the photo on the approval — the web's
 * addSamplePhotos only re-checks, it writes nothing), the thumbnail job
 * enqueued.
 *
 * The body carries the `key` from step one and the file's name, type and
 * size; the approval, its project and the entity type (`approval`) are the
 * server's. The approval must exist for this user and still be pending
 * (approvalForPhotos); the attachments freeze (RLS, migrations 0036/0037)
 * refuses a decided or deleted approval regardless.
 *
 * Bearer only (no cookie); admin/site (client → 403); project access.
 * Returns the new attachment's id and nothing about where it is stored.
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

export async function POST(request: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    // Real role, from the bearer session; a client stops here (403).
    const session = await requireRole(["admin", "site"]);

    const { approvalId } = await params;
    // Not an id at all: the same answer as an approval that does not exist.
    if (!isUuid(approvalId)) {
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

    // Exists for this user and still pending (NOT_FOUND / ILLEGAL_TRANSITION).
    const approval = await approvalForPhotos(approvalId);
    await requireProjectAccess(session, approval.projectId);

    // The upload's own facts from the body; where it belongs is the server's.
    const { key, fileName, mimeType, sizeBytes } = body as Record<string, unknown>;
    const parsed = confirmUploadSchema.safeParse({
      key,
      fileName,
      mimeType,
      sizeBytes,
      projectId: approval.projectId,
      entityType: "approval",
      entityId: approval.id,
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
