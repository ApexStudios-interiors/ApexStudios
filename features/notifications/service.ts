import { isUuid } from "@/lib/routing/slug";

/**
 * The one rule that decides whether a notification counts toward the bell's
 * badge, kept pure so it can be tested without a database.
 *
 * D60 (2026-09-28) gave the bell per-user read state, partially reversing
 * ADR-014. The badge counts UNREAD items; the dropdown still lists every
 * item, read or not, because a read notification is not finished work.
 */

/** A read receipt from `notification_reads`, keyed the same way the view is. */
export type ReadReceipt = { kind: string; entityId: string; readAt: string };

/** The key under which a notification's read receipt is stored. */
export function readKey(kind: string, entityId: string): string {
  return `${kind}:${entityId}`;
}

export function receiptsByKey(receipts: readonly ReadReceipt[]): Map<string, string> {
  return new Map(receipts.map((r) => [readKey(r.kind, r.entityId), r.readAt]));
}

/**
 * Unread when the user has never opened it, OR when the work was raised again
 * AFTER they last opened it.
 *
 * That second clause is the whole reason `read_at` is a timestamp rather than
 * a boolean. `v_notifications` recomputes `created_at` from the underlying
 * row — `stock_requests.created_at`, `bills.submitted_at`,
 * `inventory_items.updated_at` — so a stock request that returns to pending,
 * or an item that drops below its reorder level a second time, presents a
 * newer `created_at` than the old receipt and correctly becomes unread again.
 * Without it, looking at a notification once would permanently silence that
 * entity.
 *
 * Equal timestamps count as READ: the receipt is written at or after the
 * moment the item was rendered, so `read_at === created_at` can only mean the
 * same occurrence, never a new one.
 */
export function isUnread(
  notification: { kind: string; entityId: string; createdAt: string },
  readAtByKey: ReadonlyMap<string, string>
): boolean {
  const readAt = readAtByKey.get(readKey(notification.kind, notification.entityId));
  if (readAt === undefined) return true;
  return Date.parse(notification.createdAt) > Date.parse(readAt);
}

export function countUnread(
  notifications: readonly { kind: string; entityId: string; createdAt: string }[],
  readAtByKey: ReadonlyMap<string, string>
): number {
  return notifications.reduce((n, item) => n + (isUnread(item, readAtByKey) ? 1 : 0), 0);
}

// ── Kinds, audiences and the "Needs my action" inbox (D72, 2026-11-24) ──────
//
// Pure rules over what `v_notifications` emits (migration 20261124500001).
// The view decides what EXISTS and RLS decides what a session may READ; these
// decide which of those rows are this person's business, and where they show.

/** Every kind the bell lists. The first four are the original ones; the rest
 *  are status changes (APX-18, APX-62), windowed to 14 days in the view and
 *  dated by the transition itself so a read receipt still works. */
export const BELL_KINDS = [
  "stock_request",
  "bill_submitted",
  "approval_pending",
  "inventory_low",
  "stock_approved",
  "stock_ordered",
  "stock_delivered",
  "stock_rejected",
  "approval_approved",
  "approval_rejected",
  "bill_certified",
  "bill_rejected",
] as const;
export type BellKind = (typeof BELL_KINDS)[number];

/** State-only rows the view emits for the inbox and the bell leaves out:
 *  a draft bill or an unpaid one is work, but it is not news. */
export const INBOX_ONLY_KINDS = ["bill_draft", "bill_unpaid", "approval_revision", "delivery_due"] as const;
export type InboxOnlyKind = (typeof INBOX_ONLY_KINDS)[number];

export type NotificationKind = BellKind | InboxOnlyKind;

export type AudienceRole = "admin" | "site" | "client";

/**
 * What is WAITING on each role — the inbox. Only kinds whose next step is
 * this role's to take:
 *
 * - Admin: pending stock requests to decide, draft bills to submit, certified
 *   bills to record payment against, rejected approvals to revise.
 * - Site: ordered deliveries to receive, and their own rejected requests.
 * - Client: approvals to decide and submitted bills to certify.
 *
 * Never a stock kind for a client, never a bill kind for site (no money for
 * Site Supervisors — and these titles carry no amount regardless).
 */
export const ACTION_KINDS: Record<AudienceRole, readonly NotificationKind[]> = {
  admin: ["stock_request", "bill_draft", "bill_unpaid", "approval_revision"],
  site: ["delivery_due", "stock_rejected"],
  client: ["approval_pending", "bill_submitted"],
};

export function isBellKind(kind: string): kind is BellKind {
  return (BELL_KINDS as readonly string[]).includes(kind);
}

/** Short, plain label for the inbox's "Action" column. */
export const ACTION_LABEL: Record<NotificationKind, string> = {
  stock_request: "Decide request",
  bill_submitted: "Certify bill",
  approval_pending: "Decide approval",
  inventory_low: "Low stock",
  stock_approved: "Request approved",
  stock_ordered: "Ordered",
  stock_delivered: "Delivered",
  stock_rejected: "Re-raise or close",
  approval_approved: "Approved",
  approval_rejected: "Rejected",
  bill_certified: "Bill certified",
  bill_rejected: "Bill rejected",
  bill_draft: "Submit bill",
  bill_unpaid: "Record payment",
  approval_revision: "Raise revision",
  delivery_due: "Receive delivery",
};

/** The part of a Session these rules read — kept structural so this file
 *  needs no server-only import. */
export type AudienceSession = {
  userId: string;
  role: AudienceRole;
  impersonating: { role: AudienceRole; projectId: string } | null;
};

const ROLES: readonly string[] = ["admin", "site", "client"];

/** Matches no row: `entity_id` is never null in the view. Used when a value
 *  that would go into the filter fails validation — fail closed (an empty
 *  bell) rather than throw from the app shell on every page. */
export const MATCH_NOTHING = "entity_id.is.null";

/**
 * The PostgREST `or` filter selecting the rows that are this session's
 * business — one expression, so there is no question of how two chained
 * filters combine.
 *
 * Normally: rows addressed to the role (`for_roles`) or to this person by name
 * (`for_profile_id`, the requester of a stock request or approval).
 *
 * Previewing (APX-65): an admin previewing a role on one project sees that
 * project only — plus central-store inventory, which has no project and which
 * that role would see too. A preview is of a ROLE, not a person, so a named
 * row counts when its recipient holds the previewed role
 * (`for_profile_role`): "what would a Site Supervisor on this project be
 * told", never the admin's own requests.
 *
 * Every interpolated value is checked first — the role against the closed
 * set, ids as UUIDs — so nothing a user typed can reach the filter string;
 * a value that fails the check yields MATCH_NOTHING.
 */
export function audienceFilter(session: AudienceSession): string {
  if (session.impersonating) {
    const { role, projectId } = session.impersonating;
    if (!ROLES.includes(role) || !isUuid(projectId)) return MATCH_NOTHING;
    return [
      `and(project_id.eq.${projectId},for_roles.cs.{${role}})`,
      `and(project_id.eq.${projectId},for_profile_role.eq.${role})`,
      `and(project_id.is.null,for_roles.cs.{${role}})`,
    ].join(",");
  }
  if (!ROLES.includes(session.role) || !isUuid(session.userId)) return MATCH_NOTHING;
  return `for_roles.cs.{${session.role}},for_profile_id.eq.${session.userId}`;
}

/** The role whose rules apply: the previewed one while previewing. */
export function audienceRole(session: AudienceSession): AudienceRole {
  return session.impersonating?.role ?? session.role;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days an item has been waiting, for the inbox's Waiting column. Floors,
 * so anything under 24 hours old is 0; never negative (an app clock a few
 * seconds behind the database must not show -1).
 */
export function ageInDays(createdAt: string, now: number): number {
  const then = Date.parse(createdAt);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/** "Today", "1 day", "12 days". */
export function ageLabel(days: number): string {
  if (days <= 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}
