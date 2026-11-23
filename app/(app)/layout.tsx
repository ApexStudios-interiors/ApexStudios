import { redirect } from "next/navigation";
import { AppProvider } from "@/context/AppContext";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { Toast } from "@/components/ui/Toast";
import { DialogHost } from "@/components/shared/DialogHost";
import { PreviewBanner } from "@/components/auth/PreviewBanner";
import { getSession } from "@/lib/auth/session";
import { BackupAlertBanner } from "@/components/layout/BackupAlertBanner";
import { loadShellData } from "./shell-data";

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

  // The bell, the sidebar's projects, their badge counts and the admin backup
  // banner — all read in parallel, all non-essential: a failure in any of them
  // renders the shell without that piece rather than failing every route
  // (APX-52). See ./shell-data.ts.
  const { notifications, unreadCount, projects, backupAlert } = await loadShellData(session);

  return (
    <SessionProvider session={session}>
      <AppProvider initialRole={effectiveRole}>
        {session.impersonating && <PreviewBanner role={session.impersonating.role} />}
        {backupAlert && <BackupAlertBanner alert={backupAlert} />}
        <div className="grid grid-cols-[250px_1fr] min-h-screen">
          <Sidebar projects={projects} />
          <div className="min-w-0">
            <Header notifications={notifications} unreadCount={unreadCount} projects={projects} />
            <div className="p-7 max-w-[1280px]">{children}</div>
          </div>
        </div>
        <DialogHost />
        <Toast />
      </AppProvider>
    </SessionProvider>
  );
}
