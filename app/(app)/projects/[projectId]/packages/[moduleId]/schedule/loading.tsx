import { Card } from "@/components/ui/Card";

/** build/05-schedule-and-progress.md §3.5 step 3: a skeleton that reserves
 *  the grid's exact height, so the page does not jump once the real Gantt
 *  streams in. Matches Gantt.tsx's own row heights (28px group rows, 46px
 *  task rows) rather than an arbitrary placeholder size. */
export default function PackageScheduleLoading() {
  return (
    <Card>
      <div className="overflow-x-auto animate-pulse">
        <div className="min-w-[960px] h-9 border-b border-border bg-muted/50" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <div className="min-w-[960px] h-[28px] bg-muted/50 border-b border-border" />
            <div className="min-w-[960px] h-[46px] border-b border-border" />
            <div className="min-w-[960px] h-[46px] border-b border-border" />
          </div>
        ))}
      </div>
    </Card>
  );
}
