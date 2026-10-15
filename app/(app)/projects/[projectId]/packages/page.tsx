import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getProjectHeader } from "@/features/projects/queries";
import { getPackagesForProject } from "@/features/packages/queries";
import { ModuleTable } from "@/features/packages/components/ModuleTable";
import { PackageSearchInput } from "@/features/packages/components/PackageSearchInput";
import { PackageStatusTabs } from "@/features/packages/components/PackageStatusTabs";
import {
  PACKAGE_FILTER_THRESHOLD,
  filterPackageRows,
  packageStatusOptions,
} from "@/features/packages/service";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/Icon";
import { projectBase } from "@/lib/routing/current";

/** build/04-projects-packages-phases.md §4.4 step 3: the same table as the
 *  dashboard, full width. From PACKAGE_FILTER_THRESHOLD packages up it also
 *  gets a search (`q`) and status tabs (`status`), read from the URL and
 *  applied to the rows already loaded; while either is active the table's
 *  Total row is hidden, since it totals the whole project, not the rows shown. */
export default async function PackagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { projectId } = await params;
  const { q = "", status = "" } = await searchParams;
  const session = await requireSession();

  const header = await getProjectHeader(session, projectId);
  if (!header) notFound();

  const packages = await getPackagesForProject(session, projectId);
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isMoney = effectiveRole === "admin";

  const filterable = packages.packages.length >= PACKAGE_FILTER_THRESHOLD;
  const filtered = filterable && (q.trim() !== "" || status !== "");
  const shown = filtered
    ? { ...packages, packages: filterPackageRows(packages.packages, { q, status }) }
    : packages;

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Packages</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">
            {filtered
              ? `${shown.packages.length} of ${packages.packages.length} packages`
              : `${packages.packages.length} packages`}
          </p>
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
      {filterable && (
        <div className="flex gap-3 items-center flex-wrap">
          <PackageStatusTabs items={packageStatusOptions(packages.packages)} status={status} />
          <PackageSearchInput value={q} />
        </div>
      )}
      <Card>
        {filtered && shown.packages.length === 0 ? (
          <Empty>No packages match.</Empty>
        ) : (
          <ModuleTable
            base={await projectBase(projectId)}
            data={shown as typeof packages}
            projectProgressPct={header.progressPct}
            hideTotals={filtered}
          />
        )}
      </Card>
    </div>
  );
}
