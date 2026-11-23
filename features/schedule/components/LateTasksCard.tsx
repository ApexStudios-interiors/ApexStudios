import Link from "next/link";
import type { TaskBriefDTO } from "@/features/schedule/queries";
import { Card, CardHeader } from "@/components/ui/Card";
import { plural } from "@/lib/plural";
import { TaskBriefList } from "./TaskBriefList";

/**
 * APX-48: the admin project dashboard's Late tasks card — tasks past their end
 * date and under 100%, oldest due first. Renders nothing when none are late,
 * like the dashboard's other "only when there is something" cards.
 */
export function LateTasksCard({
  tasks,
  lateCount,
  scheduleHref,
  today,
}: {
  tasks: TaskBriefDTO[];
  /** All late tasks — `tasks` is capped for the card. */
  lateCount: number;
  scheduleHref: string;
  today: string;
}) {
  if (lateCount === 0) return null;
  return (
    <Card className="mb-5">
      <CardHeader>
        <h3>Late tasks</h3>
        <span className="text-muted-foreground text-sm">{plural(lateCount, "task")} past due</span>
        <Link
          href={scheduleHref}
          className="ml-auto text-[13px] font-medium underline underline-offset-2 hover:text-foreground text-muted-foreground"
        >
          Open schedule
        </Link>
      </CardHeader>
      <TaskBriefList tasks={tasks} today={today} />
    </Card>
  );
}
