import { requireSession } from "@/lib/auth/session";
import { getPhasesForPackage } from "@/features/packages/queries";
import { PhaseTable } from "@/features/packages/components/PhaseTable";
import { Card } from "@/components/ui/Card";

/** build/04-projects-packages-phases.md §4.4 step 4: the Budget/Phases tab,
 *  the only tab this build converts. */
export default async function PackageBudgetTab({
  params,
}: {
  params: Promise<{ projectId: string; moduleId: string }>;
}) {
  const { projectId, moduleId } = await params;
  const session = await requireSession();
  const phases = await getPhasesForPackage(session, projectId, moduleId);

  return (
    <Card>
      <PhaseTable data={phases} />
    </Card>
  );
}
