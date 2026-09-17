import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/TableSkeleton";

/** Users: heading, the Add User button, and a page of rows (Name, Contact,
 *  Role, actions). */
export default function UsersLoading() {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div>
          <Skeleton className="h-8 w-28" />
          <Skeleton className="mt-2 h-4 w-20" />
        </div>
        <Skeleton className="ml-auto h-9 w-28" />
      </div>
      <Card>
        <TableSkeleton columns={4} />
      </Card>
    </div>
  );
}
