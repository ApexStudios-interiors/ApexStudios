import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getProjectHeader } from "@/features/projects/queries";
import { getScheduleForProject } from "@/features/schedule/queries";
import { ScheduleCards } from "./ScheduleCards";

/** build/05-schedule-and-progress.md §3.5 step 1: one collapsible card per
 *  package, "{n} tasks · {progress}%" or "No plan yet". Expansion state is
 *  client state (`ScheduleCards`); the data itself is server-fetched here. */
export default async function SchedulePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await requireSession();

  const header = await getProjectHeader(session, projectId);
  if (!header) notFound();

  const schedule = await getScheduleForProject(session, projectId);
  const effectiveRole = session.impersonating?.role ?? session.role;
  const canEdit = effectiveRole !== "client";

  return <ScheduleCards projectId={projectId} header={header} schedule={schedule} canEdit={canEdit} />;
}
