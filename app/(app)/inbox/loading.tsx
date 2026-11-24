import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/TableSkeleton";

/** "Needs my action": heading, one line of intro, then a page of rows. */
export default function InboxLoading() {
  return (
    <div aria-busy="true" aria-label="Loading what needs your action">
      <div className="mb-[22px]">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-[420px] max-w-full" />
      </div>
      <Card>
        <TableSkeleton columns={5} />
      </Card>
    </div>
  );
}
