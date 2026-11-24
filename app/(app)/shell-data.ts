import "server-only";
import type { Session } from "@/lib/auth/session";
import { getBellNotifications, type NotificationDTO } from "@/features/notifications/queries";
import { getPortfolio } from "@/features/projects/queries";
import { getPackageNavLists } from "@/features/packages/queries";
import { countPendingRequestsByProject } from "@/features/stock/queries";
import { countPendingApprovalsByProject } from "@/features/approvals/queries";
import { countSubmittedBillsByProject } from "@/features/billing/queries";
import { getBackupAlert, type BackupAlert } from "@/features/ops/queries";
import type { NavProject } from "@/components/layout/nav-project";

export type ShellData = {
  notifications: NotificationDTO[];
  unreadCount: number;
  projects: NavProject[];
  backupAlert: BackupAlert | null;
};

/**
 * A settled read, or its fallback. Logged with console.error so a degraded
 * shell is visible in the Vercel logs (D50), never silent.
 */
export function valueOr<T>(result: PromiseSettledResult<T>, fallback: T, what: string): T {
  if (result.status === "fulfilled") return result.value;
  console.error(`[shell] ${what} failed; rendering without it`, result.reason);
  return fallback;
}

/**
 * Everything the authenticated app shell shows around a page: the bell, the
 * sidebar's projects with their package lists and badge counts, and (admin
 * only) the backup banner.
 *
 * APX-52. Every one of these is NON-essential to the page inside the shell,
 * so each is read with Promise.allSettled and falls back to "nothing to
 * show": one transient error in the notifications view used to throw out of
 * the layout and take down EVERY route with an unstyled application error.
 * Now the page still renders, without the bell (or without the badge counts),
 * and the failure is logged. Errors a PAGE needs (its own getPortfolio call,
 * say) still reach that page's error boundary, because the cached promise
 * rejects for it too.
 *
 * APX-26. getBellNotifications, getPortfolio and getPackageNavLists are React
 * cache()d, so a page that asks for the same data in the same render (the
 * home page's portfolio, the portfolio's own package counts) reuses these
 * round trips rather than repeating them.
 */
export async function loadShellData(session: Session): Promise<ShellData> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isClient = effectiveRole === "client";

  const [bellRes, portfolioRes, backupRes] = await Promise.allSettled([
    getBellNotifications(session),
    getPortfolio(session),
    // Admin only, and not while previewing another role: the preview should
    // look like that role's shell.
    effectiveRole === "admin" ? getBackupAlert() : Promise.resolve(null),
  ]);

  const bell = valueOr(bellRes, { items: [], unreadCount: 0 }, "notifications");
  const portfolio = valueOr(portfolioRes, null, "portfolio");
  const backupAlert = valueOr(backupRes, null, "backup status");

  const portfolioProjects = portfolio?.projects ?? [];
  const projectIds = portfolioProjects.map((p) => p.id);

  // Fetched for the WHOLE portfolio rather than the open project, because a
  // layout is not re-rendered on navigation (see the layout's own comment).
  // Only the badges a role shows: stock pending for everyone but a client,
  // approvals pending and bills submitted for a client only.
  const none: Record<string, number> = {};
  const [packagesRes, requestsRes, approvalsRes, billsRes] = await Promise.allSettled([
    getPackageNavLists(session, projectIds),
    isClient ? none : countPendingRequestsByProject(session, projectIds),
    isClient ? countPendingApprovalsByProject(projectIds) : none,
    isClient ? countSubmittedBillsByProject(projectIds) : none,
  ]);
  const packagesByProject = valueOr(packagesRes, {}, "sidebar package lists");
  const pendingRequests = valueOr(requestsRes, none, "pending stock request counts");
  const pendingApprovals = valueOr(approvalsRes, none, "pending approval counts");
  const submittedBills = valueOr(billsRes, none, "submitted bill counts");

  const projects: NavProject[] = portfolioProjects.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    packages: packagesByProject[p.id] ?? [],
    pendingRequests: pendingRequests[p.id] ?? 0,
    pendingApprovals: pendingApprovals[p.id] ?? 0,
    submittedBills: submittedBills[p.id] ?? 0,
  }));

  return { notifications: bell.items, unreadCount: bell.unreadCount, projects, backupAlert };
}
