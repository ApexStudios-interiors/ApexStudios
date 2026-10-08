import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireSession } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { getBearerToken } from "@/lib/supabase/server";
import { markNotificationReadSchema } from "@/features/notifications/schema";
import { markNotificationReadFor } from "@/features/notifications/read";

/**
 * POST /api/mobile/v1/notifications/read — the signed-in user has opened one
 * notification. The mobile counterpart of the web bell's
 * `markNotificationRead` action (features/notifications/actions.ts): same
 * schema, same shared helper (features/notifications/read.ts).
 *
 *   body: { "kind": "stock_request" | "bill_submitted" | "approval_pending"
 *                   | "inventory_low", "entityId": "<uuid>" }
 *
 * A notification has no id of its own: v_notifications is computed live, and
 * one is identified by its kind and the record it is about — the same pair
 * GET /api/mobile/v1/notifications returns and the web bell sends.
 *
 * Bearer only. createClient()/getSession() would also accept a browser's
 * session cookie, so this write refuses any request without an
 * `Authorization: Bearer` header first. Any signed-in role may mark its own
 * notifications read. Whose read state changes is never the client's to say:
 * the helper writes `profile_id` from the session, and RLS (nr_insert_own /
 * nr_update_own) allows only the caller's own row — so no request can touch
 * another user's. Marking an already-read notification again is safe (an
 * upsert that refreshes `read_at`, exactly as the web does).
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

export async function POST(request: Request) {
  try {
    if (!(await getBearerToken())) throw new UnauthenticatedError();
    const session = await requireSession();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "VALIDATION", "Request body must be valid JSON.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return errorResponse(400, "VALIDATION", "Request body must be a JSON object.");
    }

    // Only the notification's identity is read from the body — never whose
    // read state it is.
    const { kind, entityId } = body as { kind?: unknown; entityId?: unknown };
    const parsed = markNotificationReadSchema.safeParse({ kind, entityId });
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    await markNotificationReadFor(session, parsed.data);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
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
