import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireSession } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { getBearerToken } from "@/lib/supabase/server";
import { changeMyPasswordSchema } from "@/features/users/schema";
import {
  CHANGE_MY_PASSWORD_REFUSAL_MESSAGES,
  changeMyPassword,
  type ChangeMyPasswordRefusal,
} from "@/features/users/service";
import { bearerPasswordSteps } from "@/features/users/own-password";

/**
 * POST /api/mobile/v1/account/password — the signed-in user changes their
 * own password. The mobile counterpart of the web's changeMyPasswordAction
 * (features/users/actions.ts, ChangeMyPasswordDialog): the same schema
 * (changeMyPasswordSchema — all three trimmed, 12 characters to 72 bytes,
 * the two new ones matching, different from the current one) and the same
 * service (changeMyPassword: re-authenticate with the current password,
 * then set the new one), with the bearer-session steps
 * (features/users/own-password.ts).
 *
 *   body: { currentPassword, newPassword, confirmPassword }
 *
 * Whose password is the session's — nothing in the request can name another
 * user, and only the user's own token reaches GoTrue (no service_role). After
 * a change this phone stays signed in and every other session of the account
 * is signed out, exactly as on the web.
 *
 * A refusal (wrong current password, same as current, no username) is 422
 * with the web's own copy — never 401, which the app reads as "session
 * expired". Bearer only (no cookie); any signed-in role. No password is ever
 * logged, returned, or put in an error. Returns `{ ok: true }`.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** HTTP status for each domain code this route can meet. Anything else is
 *  an unexpected failure: 500. */
const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
};

/** The refusal's code in the response — the service's reason, upper-cased. */
const REFUSAL_CODE: Record<ChangeMyPasswordRefusal, string> = {
  no_email: "NO_EMAIL",
  same_as_current: "SAME_AS_CURRENT",
  wrong_password: "WRONG_PASSWORD",
};

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  try {
    const token = await getBearerToken();
    if (!token) throw new UnauthenticatedError();
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

    // Only the three passwords are read; no user id is ever taken from here.
    const { currentPassword, newPassword, confirmPassword } = body as Record<string, unknown>;
    const parsed = changeMyPasswordSchema.safeParse({ currentPassword, newPassword, confirmPassword });
    if (!parsed.success) {
      // The schema's own fixed messages — none of them echoes a value.
      return errorResponse(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const result = await changeMyPassword(
      bearerPasswordSteps(token),
      { email: session.email },
      { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword }
    );
    if (result.status === "refused") {
      return errorResponse(
        422,
        REFUSAL_CODE[result.reason],
        CHANGE_MY_PASSWORD_REFUSAL_MESSAGES[result.reason]
      );
    }
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
    // mapDomainError owns the user-facing copy (and logs an unmapped error —
    // a GoTrue code or status, never a password — with the reference it
    // returns).
    const message = mapDomainError(err);
    if (code && status) return errorResponse(status, code, message);
    return errorResponse(500, "INTERNAL", message);
  }
}
