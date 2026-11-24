import Link from "next/link";
import type { TaskBriefDTO } from "@/features/schedule/queries";
import type { DeliveryDueDTO } from "@/features/stock/queries";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { TaskBriefList } from "@/features/schedule/components/TaskBriefList";
import { dmy } from "@/lib/format";
import { plural } from "@/lib/plural";

/**
 * APX-48: the Site Supervisor's "what am I doing today" card on the project
 * dashboard — tasks that are late or under way, and ordered material due on
 * site in the next few days. No money anywhere: tasks carry none, and the
 * deliveries come from `v_stock_request_site`, which has no rate or value.
 */
export function TodayCard({
  late,
  inProgress,
  deliveries,
  scheduleHref,
  stockHref,
  today,
}: {
  late: TaskBriefDTO[];
  inProgress: TaskBriefDTO[];
  deliveries: DeliveryDueDTO[];
  scheduleHref: string;
  stockHref: string;
  today: string;
}) {
  const tasks = [...late, ...inProgress];
  return (
    <Card className="mb-5">
      <CardHeader>
        <h3>Today</h3>
        <span className="text-muted-foreground text-sm">{dmy(today)}</span>
      </CardHeader>

      <section aria-labelledby="today-tasks">
        <div className="px-5 pt-3 pb-1 flex items-center gap-2">
          <h4
            id="today-tasks"
            className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Tasks · {plural(tasks.length, "open task")}
          </h4>
          <Link
            href={scheduleHref}
            className="ml-auto text-[13px] font-medium underline underline-offset-2 text-muted-foreground hover:text-foreground"
          >
            Schedule
          </Link>
        </div>
        {tasks.length > 0 ? (
          <TaskBriefList tasks={tasks} today={today} />
        ) : (
          <p className="px-5 pb-3 text-[13.5px] text-muted-foreground">Nothing under way or overdue.</p>
        )}
      </section>

      <section aria-labelledby="today-deliveries" className="border-t border-border">
        <div className="px-5 pt-3 pb-1 flex items-center gap-2">
          <h4
            id="today-deliveries"
            className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Deliveries due · {deliveries.length}
          </h4>
          <Link
            href={`${stockHref}?status=ordered`}
            className="ml-auto text-[13px] font-medium underline underline-offset-2 text-muted-foreground hover:text-foreground"
          >
            Stock requests
          </Link>
        </div>
        {deliveries.length > 0 ? (
          <ul className="divide-y divide-border">
            {deliveries.map((d) => {
              const overdue = d.neededBy != null && d.neededBy < today;
              return (
                <li key={d.id} className="px-5 py-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium truncate">{d.materialName}</div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {d.refNo} · {d.qty} {d.unit}
                    </div>
                  </div>
                  <div className="flex-none text-right">
                    {overdue ? (
                      <Badge variant="warning">Overdue · {dmy(d.neededBy)}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {d.neededBy ? `Due ${dmy(d.neededBy)}` : "No date"}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 pb-3 text-[13.5px] text-muted-foreground">
            No deliveries due in the next 3 days.
          </p>
        )}
      </section>
    </Card>
  );
}
