import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/TableSkeleton";

/** Stock Requests: heading, the New Request button, the status tabs and the
 *  package filter, then a page of request rows. */
export default function StockLoading() {
  return (
    <div>
      <div className="mb-[22px] flex flex-wrap items-start gap-4">
        <div>
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-2 h-4 w-24" />
        </div>
        <Skeleton className="ml-auto h-9 w-32" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="mb-4 h-9 w-[360px]" />
        <Skeleton className="h-9 w-40" />
      </div>
      <Card>
        <TableSkeleton columns={6} />
      </Card>
    </div>
  );
}
