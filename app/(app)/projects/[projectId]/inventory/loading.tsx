import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatBarSkeleton } from "@/components/shared/StatBarSkeleton";
import { TableSkeleton } from "@/components/shared/TableSkeleton";

/** Project Inventory: heading, the four stat tiles, a page of item rows. */
export default function ProjectInventoryLoading() {
  return (
    <div>
      <div className="mb-[22px]">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-56" />
      </div>
      <StatBarSkeleton />
      <Card>
        <TableSkeleton columns={5} />
      </Card>
    </div>
  );
}
