import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/TableSkeleton";

/** Approvals: heading, the Request Approval button, the status tabs, then a
 *  page of approval rows. */
export default function ApprovalsLoading() {
  return (
    <div>
      <div className="mb-[22px] flex flex-wrap items-start gap-4">
        <div>
          <Skeleton className="h-8 w-44" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <Skeleton className="ml-auto h-9 w-40" />
      </div>
      <Skeleton className="mb-4 h-9 w-[280px]" />
      <Card>
        <TableSkeleton columns={7} />
      </Card>
    </div>
  );
}
