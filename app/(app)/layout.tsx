import { redirect } from "next/navigation";
import { AppProvider } from "@/context/AppContext";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { Toast } from "@/components/ui/Toast";
import { DialogHost } from "@/components/shared/DialogHost";
import { PreviewBanner } from "@/components/auth/PreviewBanner";
import { getSession } from "@/lib/auth/session";
import { requiresMfa } from "@/lib/auth/mfa";
import { getNotifications } from "@/features/notifications/queries";

/**
 * The authenticated app shell: Sidebar, Header, the mock-data AppProvider
 * (still driving the UI until Build 04-09 replace it feature by feature), the
 * dialog host and the toast. Moved here from app/layout.tsx (build/03) so that
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
  // D22: requireRole refuses every owner/admin action below aal2. Without this
  // the shell would render and each click would fail with "no permission";
  // /mfa either sets TOTP up or asks for the code. Checks the REAL role, same
  // as requireRole — previewing another role (D20) does not skip it.
  if (requiresMfa(session.role) && session.aal !== "aal2") redirect("/mfa");

  const effectiveRole = session.impersonating?.role ?? session.role;
  const notifications = await getNotifications(session);

  return (
    <SessionProvider session={session}>
      <AppProvider initialRole={effectiveRole}>
        {session.impersonating && <PreviewBanner role={session.impersonating.role} />}
        <div className="grid grid-cols-[250px_1fr] min-h-screen">
          <Sidebar />
          <div className="min-w-0">
            <Header notifications={notifications} />
            <div className="p-7 max-w-[1280px]">{children}</div>
          </div>
        </div>
        <DialogHost />
        <Toast />
      </AppProvider>
    </SessionProvider>
  );
}
