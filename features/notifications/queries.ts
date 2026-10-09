import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import { isUnread, receiptsByKey, type ReadReceipt } from "./service";
import { projectPath } from "@/lib/routing/paths";

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
  const [projectRefs, reads] = await Promise.all([
    fetchProjectRefs(rows.map((r) => r.project_id).filter((id): id is string => id != null)),
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
    projectName: r.project_id ? (projectRefs.get(r.project_id)?.name ?? null) : null,
    title: r.title,
    href: r.project_id ? canonicalHref(r.href, r.project_id, projectRefs.get(r.project_id)) : r.href,
    createdAt: r.created_at,
    unread: isUnread({ kind: r.kind, entityId: r.entity_id, createdAt: r.created_at }, readAtByKey),
  }));
}

type ProjectRefRow = { name: string; code: string };

/**
 * Name AND code for each project a notification points at.
 *
 * The code costs nothing — one more column on a query already being made —
 * and is what lets the href below be canonical. `v_notifications` builds its
 * href in SQL from the project UUID (`'/projects/' || sr.project_id || …`),
 * because a view has no business knowing about slugs; rewriting it here keeps
 * that so, and keeps the bell's links from costing a redirect each.
 */
async function fetchProjectRefs(projectIds: string[]): Promise<Map<string, ProjectRefRow>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("id, name, code").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map(data.map((p) => [p.id, { name: p.name, code: p.code }]));
}

/**
 * Swaps the UUID the view emitted for the project's code, leaving the rest of
 * the path alone. Falls back to the view's own href when the code is not to
 * hand — a UUID link still resolves through middleware, so a notification
 * stays clickable rather than broken.
 */
function canonicalHref(viewHref: string, projectId: string, ref: ProjectRefRow | undefined): string {
  if (!ref?.code) return viewHref;
  const prefix = `/projects/${projectId}`;
  if (!viewHref.startsWith(prefix)) return viewHref;
  return projectPath({ code: ref.code }, viewHref.slice(prefix.length));
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
