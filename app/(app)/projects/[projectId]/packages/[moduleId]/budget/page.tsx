import { requireSession } from "@/lib/auth/session";
import { getPhasesForPackage } from "@/features/packages/queries";
import { getProjectStatus } from "@/features/projects/queries";
import { projectWriteRefusal } from "@/features/projects/service";
import { PhaseTable } from "@/features/packages/components/PhaseTable";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

/** build/04-projects-packages-phases.md §4.4 step 4: the Budget/Phases tab.
 *  APX-10: admins add and edit phases here — the only place phases are made,
 *  besides Add Task's "Create phase" when a package has none. */
export default async function PackageBudgetTab({
  params,
}: {
  params: Promise<{ projectId: string; moduleId: string }>;
}) {
  const { projectId, moduleId } = await params;
  const session = await requireSession();
  const [phases, status] = await Promise.all([
    getPhasesForPackage(session, projectId, moduleId),
    getProjectStatus(projectId),
  ]);
  const isAdmin = phases.role === "money";
  const readOnly = projectWriteRefusal(status, "edit");
  const canEdit = isAdmin && !readOnly;

  return (
    <Card>
      {isAdmin && (
        <CardHeader>
          <h3>Phases</h3>
          <div className="ml-auto">
            <OpenDialogButton
              size="sm"
              dialog={{ kind: "addPhase", projectId, moduleId }}
              disabled={!!readOnly}
              title={readOnly ?? undefined}
            >
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Add Phase
            </OpenDialogButton>
          </div>
        </CardHeader>
      )}
      <PhaseTable data={phases} edit={canEdit ? { projectId, moduleId } : undefined} />
    </Card>
  );
}
