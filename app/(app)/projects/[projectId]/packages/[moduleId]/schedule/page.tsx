import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getScheduleForPackage } from "@/features/schedule/queries";
import { Gantt } from "@/features/schedule/components/Gantt";
import { Card } from "@/components/ui/Card";

/** build/05-schedule-and-progress.md §3.5 step 2: the same Gantt, scoped to
 *  one package, now a real route with its own loading.tsx (Build 04 §4.4). */
export default async function PackageScheduleTab({
  params,
}: {
  params: Promise<{ projectId: string; moduleId: string }>;
}) {
  const { projectId, moduleId } = await params;
  const session = await requireSession();
  const schedule = await getScheduleForPackage(session, projectId, moduleId);
  if (!schedule) notFound();

  const effectiveRole = session.impersonating?.role ?? session.role;
  const canEdit = effectiveRole !== "client";

  return (
    <Card>
      <Gantt
        projectId={projectId}
        packageId={moduleId}
        phases={schedule.phases}
        projectStart={schedule.projectStart ?? ""}
        viewport={schedule.viewport}
        monthHeaders={schedule.monthHeaders}
        canEdit={canEdit}
      />
    </Card>
  );
}
