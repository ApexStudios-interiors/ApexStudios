import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A `StatBar` before its figures arrive. Deliberately the same grid, the same
 * tile padding and the same three line heights as `components/ui/StatBar`, so
 * a route's `loading.tsx` reserves the height the real stat row will take and
 * nothing below it moves when the data lands.
 */
export function StatBarSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4 mb-5">
      {Array.from({ length: tiles }).map((_, i) => (
        <Card key={i} className="px-[22px] py-[18px]">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-[7px] h-7 w-28" />
          <Skeleton className="mt-1 h-3.5 w-20" />
        </Card>
      ))}
    </div>
  );
}
