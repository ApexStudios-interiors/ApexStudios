import { redirect } from "next/navigation";
import { AppProvider } from "@/context/AppContext";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { Toast } from "@/components/ui/Toast";
import { DialogHost } from "@/components/shared/DialogHost";
import { PreviewBanner } from "@/components/auth/PreviewBanner";
import { getSession } from "@/lib/auth/session";
import { getNotifications } from "@/features/notifications/queries";
import { getPortfolio } from "@/features/projects/queries";
import { getPackageNavLists } from "@/features/packages/queries";
import { countPendingRequestsByProject } from "@/features/stock/queries";
import { countPendingApprovalsByProject } from "@/features/approvals/queries";
import { countSubmittedBillsByProject } from "@/features/billing/queries";
import type { NavProject } from "@/components/layout/nav-project";

/**
 * The authenticated app shell: Sidebar, Header, the AppProvider that still
 * holds the client-side UI state (role, dialogs, toast), the dialog host and
 * the toast. Moved here from app/layout.tsx (build/03) so that
 * app/(auth)/** can render outside it — there is no sidebar to show, and no
 * project context, before a user has signed in.
 *
 * Every route under here re-asserts the server-side redirect independently of
 * middleware.ts, which only checks "signed in", not "signed in AND active".
 * A deactivated user's session cookie can still be technically valid until it
 * expires; this is the layer that actually stops them.
 */
export default async function AppShellLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const effectiveRole = session.impersonating?.role ?? session.role;
  const notifications = await getNotifications(session);

  // The sidebar's project menu used to map over AppContext's `lib/data.ts`
  // fixture — two hard-coded prototype projects — so a project created through
  // the app was saved correctly and then never appeared in the sidebar. It
  // reads the same portfolio the All Projects page does, through the same
  // role-scoped query, so the two can no longer disagree.
  const portfolio = await getPortfolio(session);
  const projectIds = portfolio.projects.map((p) => p.id);

  // The package sub-list and the three badge counts came off the same fixture,
  // so a real project listed no packages and every badge read 0. They are real
  // reads now, every one of them through the user's own Supabase client, so
  // RLS scopes them exactly as it scopes the pages they link to.
  //
  // All of it is fetched for the WHOLE portfolio rather than for the project
  // that happens to be open, because this is a layout: Next.js does not
  // re-render a layout on navigation (see its own `layout` reference — the
  // same reason a layout cannot read search params), so a figure scoped to
  // "the open project" would freeze at whichever project the tab was first
  // opened on. Portfolio-wide is also the cheaper shape: two or three queries
  // per shell render instead of two or three per navigation, each projecting
  // one column over the pending rows only.
  //
  // Only the badges a role actually shows are fetched. Preserved exactly from
  // the prototype: stock pending for everyone but a client, approvals pending
  // and bills submitted for a client only.
  const isClient = effectiveRole === "client";
  const none: Record<string, number> = {};
  const [packagesByProject, pendingRequests, pendingApprovals, submittedBills] = await Promise.all([
    getPackageNavLists(session, projectIds),
    isClient ? none : countPendingRequestsByProject(session, projectIds),
    isClient ? countPendingApprovalsByProject(projectIds) : none,
    isClient ? countSubmittedBillsByProject(projectIds) : none,
  ]);

  const projects: NavProject[] = portfolio.projects.map((p) => ({
    id: p.id,
    name: p.name,
    packages: packagesByProject[p.id] ?? [],
    pendingRequests: pendingRequests[p.id] ?? 0,
    pendingApprovals: pendingApprovals[p.id] ?? 0,
    submittedBills: submittedBills[p.id] ?? 0,
  }));

  return (
    <SessionProvider session={session}>
      <AppProvider initialRole={effectiveRole}>
        {session.impersonating && <PreviewBanner role={session.impersonating.role} />}
        <div className="grid grid-cols-[250px_1fr] min-h-screen">
          <Sidebar projects={projects} />
          <div className="min-w-0">
            <Header notifications={notifications} projects={projects} />
            <div className="p-7 max-w-[1280px]">{children}</div>
          </div>
        </div>
        <DialogHost />
        <Toast />
      </AppProvider>
    </SessionProvider>
  );
}
