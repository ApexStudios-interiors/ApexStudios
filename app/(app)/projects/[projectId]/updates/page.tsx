import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getProjectHeader } from "@/features/projects/queries";
import { getUpdatesForProject } from "@/features/updates/queries";
import { getPackageOptions } from "@/features/updates/actions";
import { UpdateList } from "@/components/domain/UpdateList";
import { PackageFilterSelect } from "@/components/domain/PackageFilterSelect";
import { OpenDialogButton } from "@/components/domain/OpenDialogButton";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import Link from "next/link";

/**
 * build/06-files-jobs-daily-updates.md §4.2: the timeline, the package
 * filter dropdown, and "+ Post Update" hidden for the client role. A plain
 * Server Component reading `searchParams` for both the filter and
 * pagination — `PackageFilterSelect` is the one client boundary, a
 * `<select>` that navigates on change; "Load more" is a plain link.
 */
export default async function UpdatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ package?: string; cursor?: string }>;
}) {
  const { projectId } = await params;
  const { package: packageId, cursor } = await searchParams;
  const session = await requireSession();

  const header = await getProjectHeader(session, projectId);
  if (!header) notFound();

  const [page, packages] = await Promise.all([
    getUpdatesForProject(session, projectId, { packageId, cursor }),
    getPackageOptions(projectId),
  ]);

  const effectiveRole = session.impersonating?.role ?? session.role;
  const isClient = effectiveRole === "client";
  const basePath = `/projects/${projectId}/updates`;

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Daily Updates</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">
            Work done on site, posted by the site supervisor.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {!isClient && (
            <OpenDialogButton dialog={{ kind: "postUpdate", projectId }} variant="primary">
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Post Update
            </OpenDialogButton>
          )}
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <PackageFilterSelect basePath={basePath} packages={packages} value={packageId ?? ""} />
      </div>

      <Card>
        <UpdateList updates={page.items} />
      </Card>

      {page.nextCursor && (
        <div className="mt-3 text-center">
          <Link
            href={`${basePath}?${packageId ? `package=${packageId}&` : ""}cursor=${page.nextCursor}`}
            className="text-[13px] text-muted-foreground underline"
          >
            Load more
          </Link>
        </div>
      )}
    </div>
  );
}
