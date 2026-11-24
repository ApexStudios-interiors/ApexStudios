import type { TaskBriefDTO } from "@/features/schedule/queries";
import { Badge } from "@/components/ui/Badge";
import { dmy } from "@/lib/format";
import { daysBetween } from "@/features/projects/portfolio";

/**
 * A short list of tasks for a dashboard card (Late tasks, Today). One row per
 * task: name and package on the left, due date and progress on the right —
 * stacked, so it fits a 390px phone without a table. A late task says so in
 * words ("Late · 4 days"), not only in red.
 */
export function TaskBriefList({ tasks, today }: { tasks: TaskBriefDTO[]; today: string }) {
  return (
    <ul className="divide-y divide-border">
      {tasks.map((t) => (
        <li key={t.id} className="px-5 py-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium truncate">{t.name}</div>
            {t.packageName && <div className="text-xs text-muted-foreground truncate">{t.packageName}</div>}
          </div>
          <div className="text-right flex-none">
            {t.late ? (
              <Badge variant="destructive">Late · {daysBetween(t.endDate, today)}d</Badge>
            ) : (
              <span className="text-xs text-muted-foreground whitespace-nowrap">Due {dmy(t.endDate)}</span>
            )}
            <div className="text-xs text-muted-foreground mt-1 tabular-nums">{t.progressPct}% done</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
