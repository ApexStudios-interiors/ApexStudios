import { Card, CardHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatBarSkeleton } from "@/components/shared/StatBarSkeleton";
import { TableSkeleton } from "@/components/shared/TableSkeleton";

/** The project dashboard, and the fallback for any project tab without its
 *  own `loading.tsx` (Packages, Daily Updates, Billing): a heading, the
 *  budget stat row and the package table. `ProjectShell` — the project header
 *  and the tab bar — is the layout, and stays on screen. */
export default function ProjectLoading() {
  return (
    <div>
      <div className="mb-[22px]">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-48" />
      </div>
      <StatBarSkeleton />
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <TableSkeleton columns={6} />
      </Card>
    </div>
  );
}
