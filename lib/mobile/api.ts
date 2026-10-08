import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireSession, type Session } from "@/lib/auth/session";
import { codeFromPostgresMessage, mapDomainError } from "@/lib/safe-action";
import { getBearerToken } from "@/lib/supabase/server";

/**
 * The mobile API's two shared conventions (app/api/mobile/v1/**), as the
 * newer routes already apply them inline:
 *
 *  - Bearer only. createClient()/getSession() would also accept a browser's
 *    session cookie, so a mobile route refuses any request without an
 *    `Authorization: Bearer` header FIRST — a cookie can never authorize it.
 *    The token itself is then verified exactly as before, by requireSession().
 *  - Every error is `{ error: CODE, message }`, with mapDomainError's own
 *    user-facing copy — never a raw database message, stack or token.
 */

/** Responses are per-user and must never be cached. */
export const NO_STORE = { "cache-control": "no-store" } as const;

/** HTTP status for each domain code a mobile route can meet. Anything else
 *  is an unexpected failure: 500. The same table the newer routes use. */
const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ILLEGAL_TRANSITION: 409,
  REASON_REQUIRED: 422,
  RATE_LIMITED: 429,
};

/** The authenticated session — for a request carrying a Bearer token only. */
export async function requireBearerSession(): Promise<Session> {
  if (!(await getBearerToken())) throw new UnauthenticatedError();
  return requireSession();
}

export function mobileError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: NO_STORE });
}

/** 404 with the copy every "no such record" gets — a malformed id included. */
export function mobileNotFound() {
  return mobileError(404, "NOT_FOUND", mapDomainError(new Error("NOT_FOUND")));
}

/**
 * Any thrown error as the mobile error response: an auth or domain error
 * (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND:`, …) to its status with
 * mapDomainError's copy; anything else to 500 with the reference
 * mapDomainError logs it under.
 */
export function mobileErrorFrom(e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e));
  const code =
    err instanceof UnauthenticatedError
      ? "UNAUTHENTICATED"
      : err instanceof ForbiddenError
        ? "FORBIDDEN"
        : codeFromPostgresMessage(err.message);
  const status = code ? STATUS_BY_CODE[code] : undefined;
  const message = mapDomainError(err);
  if (code && status) return mobileError(status, code, message);
  return mobileError(500, "INTERNAL", message);
}
