import { requireSession } from "@/lib/auth/session";
import { getUpdatesForProject } from "@/features/updates/queries";
import { UpdateList } from "@/components/domain/UpdateList";
import { Card } from "@/components/ui/Card";
import Link from "next/link";

/**
 * build/06-files-jobs-daily-updates.md §4.2: "filtered to one package." A
 * package's `updates` tab layout already guards project/package existence
 * (`layout.tsx`), so this only needs the data. An earlier comment here said
 * "Still AppContext — Build 08 converts this tab" — that was Build 04's own
 * prediction, superseded by this build file's own §4.2, which lists this
 * route explicitly.
 */
export default async function PackageUpdatesTab({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; moduleId: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { projectId, moduleId } = await params;
  const { cursor } = await searchParams;
  const session = await requireSession();

  const page = await getUpdatesForProject(session, projectId, { packageId: moduleId, cursor });

  return (
    <>
      <Card>
        <UpdateList updates={page.items} />
      </Card>
      {page.nextCursor && (
        <div className="mt-3 text-center">
          <Link
            href={`/projects/${projectId}/packages/${moduleId}/updates?cursor=${page.nextCursor}`}
            className="text-[13px] text-muted-foreground underline"
          >
            Load more
          </Link>
        </div>
      )}
    </>
  );
}
