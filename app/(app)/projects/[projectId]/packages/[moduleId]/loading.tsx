import { Card } from "@/components/ui/Card";
import { TableSkeleton } from "@/components/shared/TableSkeleton";

/** A package tab's own content — Overview, Budget, Stock, Billing, Daily
 *  Updates. The package header and its tab bar are the layout and stay on
 *  screen; the Schedule tab has its own Gantt-shaped skeleton next to this
 *  one. */
export default function PackageTabLoading() {
  return (
    <Card>
      <TableSkeleton columns={5} />
    </Card>
  );
}
