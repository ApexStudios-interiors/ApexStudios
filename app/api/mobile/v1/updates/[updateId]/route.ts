import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireRole } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { isUuid } from "@/lib/routing/slug";
import { getBearerToken } from "@/lib/supabase/server";
import { editDailyUpdateSchema } from "@/features/updates/schema";
import { editDailyUpdateFor } from "@/features/updates/write";

/**
 * PATCH /api/mobile/v1/updates/:updateId — the author fixes the text of
 * their own daily update. The mobile counterpart of the web's
 * `editDailyUpdate` action (features/updates/actions.ts): same schema, same
 * shared write path (features/updates/write.ts).
 *
 * Body only: `{ "body": "..." }`. Any other field is refused (400) rather
 * than ignored — the date, package and project an entry is filed under
 * never change, and the database refuses it too
 * (trg_daily_updates_body_only).
 *
 * Bearer only, like every mobile mutation: a request without an
 * `Authorization: Bearer` header is refused before anything else, so a
 * browser cookie can never authorize it. requireRole matches the web
 * action's guard (admin/site; client → 403). Who may edit which update, and
 * until when, is du_update_author's decision — the author, within 24 hours —
 * which reaches the caller as ILLEGAL_TRANSITION (409), the web's own error.
 * No project access check here: the update's project is not known until the
 * row is read, and RLS only ever lets the author's own update through.
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

export async function PATCH(request: Request, { params }: { params: Promise<{ updateId: string }> }) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    // Real role, from the bearer session; a client stops here (403).
    const session = await requireRole(["admin", "site"]);

    const { updateId } = await params;
    // Not an id at all: the same answer as an update that does not exist.
    if (!isUuid(updateId)) {
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
    if (Object.keys(body).some((key) => key !== "body")) {
      return errorResponse(400, "VALIDATION", "Only the update's text can be edited.");
    }

    // The URL's id joins the body so editDailyUpdateSchema — the web
    // action's own schema — stays the single source of truth for the input.
    const parsed = editDailyUpdateSchema.safeParse({ body: (body as { body?: unknown }).body, id: updateId });
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const edited = await editDailyUpdateFor(session, parsed.data);
    return NextResponse.json({ id: edited.id }, { headers: NO_STORE });
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
