import { requireSession, requireProjectAccess } from "@/lib/auth/session";
import { ProjectShell } from "./ProjectShell";

/**
 * build/03-auth-and-rbac.md §2.8 step 4's real check, landing now as that
 * deviation note promised: `requireProjectAccess(session, projectId)` reads
 * real `project_members` rows against a real database project id. That was
 * deferred because `projectId` fed `context/AppContext.tsx`'s mock data
 * ("bhel", "arch") until this build re-keyed every mock id to its matching
 * real UUID (lib/data.ts's own header comment) — a mismatch here would have
 * 403'd every site/client session on every project route.
 *
 * `ProjectShell` no longer gates on the mock data's own existence check for
 * the same reason: a project created through the real `createProject` action
 * has no entry in the static mock array and never will, so that check always
 * said "not found" for a genuinely real, genuinely accessible project. The
 * real not-found case is now `getProjectHeader` returning null in the page
 * itself (notFound()); this layer's job is authorization, not existence.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await requireSession();
  await requireProjectAccess(session, projectId);
  return <ProjectShell>{children}</ProjectShell>;
}
