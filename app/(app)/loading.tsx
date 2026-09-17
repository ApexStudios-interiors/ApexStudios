import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatBarSkeleton } from "@/components/shared/StatBarSkeleton";

/** All Projects: the heading, the role's own stat row (three tiles is the
 *  narrowest of the three variants, so nothing over-reserves) and the project
 *  card grid — the same grid and card height `ProjectCard` renders into. */
export default function PortfolioLoading() {
  return (
    <div>
      <div className="mb-[22px]">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="mt-2 h-4 w-32" />
      </div>
      <StatBarSkeleton tiles={3} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-2 h-3.5 w-28" />
            <Skeleton className="mt-5 h-2 w-full" />
            <Skeleton className="mt-4 h-3.5 w-24" />
          </Card>
        ))}
      </div>
    </div>
  );
}
