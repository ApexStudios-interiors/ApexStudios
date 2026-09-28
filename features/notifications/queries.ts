import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import { isUnread, receiptsByKey, type ReadReceipt } from "./service";

/**
 * build/07-stock-inventory-notifications.md §2.6. Replaces `buildNotifications()`
 * in `lib/logic.ts`. One query over `v_notifications` (02-lld.md §4.4) serves
 * both the bell badge count and the dropdown — there is no separate count
 * query to drift out of sync with the list.
 *
 * Still no notifications table (ADR-014): a row exists exactly as long as the
 * thing needing attention exists. D60 (2026-09-28) added per-user READ state
 * on top of that — `notification_reads` records only that this user has seen
 * a given item, so the badge can count unread while the dropdown keeps
 * listing everything. A read notification is not finished work.
 *
 * Scoped across every project the session can access, not the current one —
 * the view is `security_invoker = on`, so each branch's own RLS policy
 * (stock_requests/bills/approvals/inventory_items) already restricts a
 * site/client session to their memberships; admin/owner see every project.
 * The `for_roles` filter on top of that is a display concern, not a security
 * one: it decides which of those already-visible rows are this role's
 * business (a site session can technically read a submitted bill row's
 * membership-scoped project, but a bill notification is not their job).
 *
 * Uses the EFFECTIVE role (impersonating ?? real) like every other read in
 * this codebase (Build 05's own rule: impersonation only ever shapes reads).
 * The prototype's `buildNotifications` gave site users submitted-bill
 * notifications too — build §2.6 calls that out as a bug being fixed here,
 * not carried forward.
 */

export type NotificationDTO = {
  kind: "stock_request" | "bill_submitted" | "approval_pending" | "inventory_low";
  entityId: string;
  projectId: string | null;
  projectName: string | null;
  title: string;
  href: string;
  createdAt: string;
  /** False once this user has opened it, until the work is raised again. */
  unread: boolean;
};

type NotificationRow = {
  kind: string;
  entity_id: string;
  project_id: string | null;
  title: string;
  href: string;
  created_at: string;
};

export async function getNotifications(session: Session): Promise<NotificationDTO[]> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_notifications")
    .select("kind, entity_id, project_id, title, href, created_at")
    .contains("for_roles", [effectiveRole])
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data as NotificationRow[];
  const [projectNames, reads] = await Promise.all([
    fetchProjectNames(rows.map((r) => r.project_id).filter((id): id is string => id != null)),
    // The REAL user's receipts, not the impersonated one's: read state belongs
    // to the person clicking. Matches markNotificationRead, which writes
    // against session.userId for the same reason.
    fetchReadReceipts(session.userId),
  ]);
  const readAtByKey = receiptsByKey(reads);

  return rows.map((r) => ({
    kind: r.kind as NotificationDTO["kind"],
    entityId: r.entity_id,
    projectId: r.project_id,
    projectName: r.project_id ? (projectNames.get(r.project_id) ?? null) : null,
    title: r.title,
    href: r.href,
    createdAt: r.created_at,
    unread: isUnread({ kind: r.kind, entityId: r.entity_id, createdAt: r.created_at }, readAtByKey),
  }));
}

async function fetchProjectNames(projectIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("id, name").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map(data.map((p) => [p.id, p.name]));
}

/**
 * Every read receipt this user holds. Unscoped by project or kind on purpose:
 * the set is bounded by (this user x notifications they have opened), which
 * for this business is tens of rows, and one unfiltered read is cheaper than
 * building an `in` list of the ids we happen to be rendering.
 *
 * `nr_select_own` restricts it to the caller's own rows regardless.
 */
async function fetchReadReceipts(profileId: string): Promise<ReadReceipt[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_reads")
    .select("kind, entity_id, read_at")
    .eq("profile_id", profileId);
  if (error) throw new Error(error.message);
  return data.map((r) => ({ kind: r.kind, entityId: r.entity_id, readAt: r.read_at }));
}
