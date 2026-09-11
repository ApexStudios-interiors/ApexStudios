import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";

/**
 * build/07-stock-inventory-notifications.md §2.6. Replaces `buildNotifications()`
 * in `lib/logic.ts`. One query over `v_notifications` (02-lld.md §4.4) serves
 * both the bell badge count and the dropdown — there is no separate count
 * query to drift out of sync with the list.
 *
 * No read state, no notifications table (ADR-014): a row exists exactly as
 * long as the thing needing attention exists, so there is nothing to mark
 * read and nothing to garbage-collect.
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
  const projectNames = await fetchProjectNames(
    rows.map((r) => r.project_id).filter((id): id is string => id != null)
  );

  return rows.map((r) => ({
    kind: r.kind as NotificationDTO["kind"],
    entityId: r.entity_id,
    projectId: r.project_id,
    projectName: r.project_id ? (projectNames.get(r.project_id) ?? null) : null,
    title: r.title,
    href: r.href,
    createdAt: r.created_at,
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
