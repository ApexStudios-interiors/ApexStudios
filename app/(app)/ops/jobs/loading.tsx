import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/TableSkeleton";

/** Failed Jobs: heading and a page of failure rows. */
export default function FailedJobsLoading() {
  return (
    <div>
      <div className="mb-5">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-52" />
      </div>
      <Card>
        <TableSkeleton columns={6} />
      </Card>
    </div>
  );
}
