import "server-only";
import { createSafeActionClient } from "next-safe-action";
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
  PREVIEW_READ_ONLY: "Preview is read-only. Exit preview to make changes.",
  // rpc_create_bill's material-at-site rules (migration 20261124200001, D69).
  MAS_SAME_BILL: "A material and its own phase can't go on the same bill — the phase already includes it.",
  MAS_DRAFT_PENDING: "Material for a selected phase is on a draft bill. Submit or cancel that draft first.",
  MAS_EXCEEDS_GROSS:
    "The material advance to recover is more than this bill's value. Add more items, or check the phase's value.",
  INVALID_PERIOD: "Give both billing period dates, with the start on or before the end.",
} as const;

/** Postgres RAISE EXCEPTION messages the RPCs use are prefixed with their code
 *  (e.g. "FORBIDDEN: certifyBill is client-only" — see migration comments),
 *  because Postgres has no first-class typed-error channel to the client.
 *  Exported so a mobile route can pick its HTTP status from the same code
 *  mapDomainError picks its message from. */
export function codeFromPostgresMessage(message: string): keyof typeof ERROR_MESSAGES | null {
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
  // column, or a value. The server log gets the real error, tagged with the
  // same request_id the user is shown, so a support conversation can find it.
  console.error(`[action] unmapped error ${requestId}`, e);
  return `Something went wrong. Reference: ${requestId}`;
}

/**
 * `actionClient` — the bare, unauthenticated client — is for the login
 * action ONLY. Every other action starts from `authedAction` or
 * one of the role-guarded clients below. Guarding is the default, not
 * something to remember (build/03-auth-and-rbac.md §2.6).
 */
export const actionClient = createSafeActionClient({
  handleServerError: mapDomainError,
});

/**
 * A signed-in session, preview or not. Only for the allow-list of actions a
 * "preview as" session may still run (APX-25): stopping or switching the
 * preview itself, marking a notification read, and pure reads (search, a
 * download URL). Everything else starts from `authedAction` below, which
 * refuses while previewing.
 */
export const previewAllowedAction = actionClient.use(async ({ next }) => {
  const session = await requireSession();
  return next({ ctx: { session } });
});

/**
 * APX-25: the preview banner promises every write is refused, so it is — here,
 * for every guarded action, rather than by each action remembering to. The
 * preview cookie only ever shaped READS (lib/auth/session.ts); without this an
 * admin previewing as Site could still Mark Delivered, as themselves.
 */
export function assertNotPreviewing(session: Session): void {
  if (session.impersonating) {
    throw new Error("PREVIEW_READ_ONLY: writes are refused while previewing another role");
  }
}

export const authedAction = previewAllowedAction.use(async ({ next, ctx }) => {
  assertNotPreviewing(ctx.session);
  return next({ ctx });
});

function roleGuarded(roles: Role[]) {
  return authedAction.use(async ({ next }) => {
    const session = await requireRole(roles);
    return next({ ctx: { session } });
  });
}

export const adminAction = roleGuarded(["admin"]);
export const siteAction = roleGuarded(["admin", "site"]);
export const clientAction = roleGuarded(["client"]);

export type ActionCtx = { session: Session };
