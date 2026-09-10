import { requireSession } from "@/lib/auth/session";
import { ProjectShell } from "./ProjectShell";

/**
 * DEVIATION from build/03-auth-and-rbac.md §2.8 step 4, recorded here rather
 * than silently applied.
 *
 * The step asks for `requireProjectAccess(session, projectId)` in this
 * layout. That call checks real `project_members` rows against a real
 * database project id — but `projectId` here is still the URL param feeding
 * `context/AppContext.tsx`'s MOCK data ("bhel", "arch"), because Build 04
 * has not yet replaced this route's data source with real queries. Wiring
 * the real check now would 403 every site/client session on every project
 * route, since "bhel" never matches an actual `projects` row — a functional
 * regression, not a security improvement.
 *
 * What this layout does today: confirm a session exists (requireSession).
 * The membership check itself lands in Build 04, at the same time the project
 * id space becomes real — see docs/progress-tracker.md.
 */
export default async function ProjectLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return <ProjectShell>{children}</ProjectShell>;
}
