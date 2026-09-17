import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatBarSkeleton } from "@/components/shared/StatBarSkeleton";
import { TableSkeleton } from "@/components/shared/TableSkeleton";

/** Business-wide Inventory: heading, the four stat tiles, the project filter
 *  and search toolbar, then a page of item rows. */
export default function BusinessInventoryLoading() {
  return (
    <div>
      <div className="mb-[22px]">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <StatBarSkeleton />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-[190px]" />
        <Skeleton className="h-9 w-64" />
      </div>
      <Card>
        <TableSkeleton columns={6} />
      </Card>
    </div>
  );
}
