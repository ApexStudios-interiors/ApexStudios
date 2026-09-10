import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getProjectHeader } from "@/features/projects/queries";
import { getPackagesForProject } from "@/features/packages/queries";
import { ModuleTable } from "@/components/domain/ModuleTable";
import { OpenDialogButton } from "@/components/domain/OpenDialogButton";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

/** build/04-projects-packages-phases.md §4.4 step 3: the same table as the
 *  dashboard, full width. */
export default async function PackagesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await requireSession();

  const header = await getProjectHeader(session, projectId);
  if (!header) notFound();

  const packages = await getPackagesForProject(session, projectId);
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isMoney = effectiveRole === "owner" || effectiveRole === "admin";

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Packages</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">{packages.packages.length} packages</p>
        </div>
        <div className="ml-auto flex gap-2">
          {isMoney && (
            <OpenDialogButton dialog={{ kind: "addModule", projectId }} variant="primary">
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Add Package
            </OpenDialogButton>
          )}
        </div>
      </div>
      <Card>
        <ModuleTable projectId={projectId} data={packages} projectProgressPct={header.progressPct} />
      </Card>
    </div>
  );
}
