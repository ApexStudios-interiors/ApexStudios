import "server-only";
import { createSafeActionClient } from "next-safe-action";
import * as Sentry from "@sentry/nextjs";
import {
  ForbiddenError,
  UnauthenticatedError,
  requireRole,
  requireSession,
  type Session,
} from "@/lib/auth/session";
import type { Role } from "@/lib/rbac/roles";

/**
 * 02-lld.md §10, in full. Domain errors are typed and mapped to user-facing
 * copy at the action boundary. A raw Postgres error string never reaches the
 * browser — they contain table and column names, and sometimes values.
 */
const ERROR_MESSAGES = {
  UNAUTHENTICATED: "Your session expired. Please sign in again.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "That record no longer exists.",
  ILLEGAL_TRANSITION: "This request has already moved on. Refresh to see the current status.",
  ALREADY_BILLED: "One or more items are already on another bill.",
  NOTHING_SELECTED: "Select at least one item to bill.",
  OVERPAYMENT: "This payment would exceed the amount owed on this bill.",
  NEGATIVE_STOCK: "Not enough stock on hand.",
  REASON_REQUIRED: "Please give a reason.",
  RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
} as const;

/** Postgres RAISE EXCEPTION messages the RPCs use are prefixed with their code
 *  (e.g. "FORBIDDEN: certifyBill is client-only" — see migration comments),
 *  because Postgres has no first-class typed-error channel to the client. */
function codeFromPostgresMessage(message: string): keyof typeof ERROR_MESSAGES | null {
  const prefix = message.split(":")[0]?.trim();
  return prefix && prefix in ERROR_MESSAGES ? (prefix as keyof typeof ERROR_MESSAGES) : null;
}

export function mapDomainError(e: Error): string {
  const requestId = crypto.randomUUID();

  if (e instanceof UnauthenticatedError) return ERROR_MESSAGES.UNAUTHENTICATED;
  if (e instanceof ForbiddenError) return ERROR_MESSAGES.FORBIDDEN;

  const pgCode = codeFromPostgresMessage(e.message);
  if (pgCode) return ERROR_MESSAGES[pgCode];

  // Unmapped: never let the raw message through. It may name a table, a
  // column, or a value. Sentry gets the real error; the user gets a
  // request_id a support conversation can find in the logs by.
  Sentry.captureException(e, { extra: { requestId } });
  return `Something went wrong. Reference: ${requestId}`;
}

/**
 * `actionClient` — the bare, unauthenticated client — is for the login and
 * magic-link actions ONLY. Every other action starts from `authedAction` or
 * one of the role-guarded clients below. Guarding is the default, not
 * something to remember (build/03-auth-and-rbac.md §2.6).
 */
export const actionClient = createSafeActionClient({
  handleServerError: mapDomainError,
});

export const authedAction = actionClient.use(async ({ next }) => {
  const session = await requireSession();
  return next({ ctx: { session } });
});

function roleGuarded(roles: Role[]) {
  return authedAction.use(async ({ next }) => {
    const session = await requireRole(roles);
    return next({ ctx: { session } });
  });
}

export const ownerAction = roleGuarded(["owner"]);
export const adminAction = roleGuarded(["owner", "admin"]);
export const siteAction = roleGuarded(["owner", "admin", "site"]);
export const clientAction = roleGuarded(["client"]);

export type ActionCtx = { session: Session };
