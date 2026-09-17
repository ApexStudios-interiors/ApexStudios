"use client";

import { useState } from "react";
import type { ProjectHeaderDTO } from "@/features/projects/queries";
import type { ProjectSchedule } from "@/features/schedule/queries";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { Gantt } from "@/features/schedule/components/Gantt";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import { dmy } from "@/lib/logic";

/**
 * The one client boundary on this page: expand/collapse is UI state, the
 * schedule data itself already arrived from the server. Matches the
 * prototype's own default — a package with no tasks starts collapsed, one
 * with a real plan starts open.
 */
export function ScheduleCards({
  projectId,
  header,
  schedule,
  canEdit,
}: {
  projectId: string;
  header: ProjectHeaderDTO;
  schedule: ProjectSchedule;
  canEdit: boolean;
}) {
  const [closed, setClosed] = useState<Set<string>>(
    () => new Set(schedule.packages.filter((p) => p.taskCount === 0).map((p) => p.packageId))
  );

  const toggle = (id: string) => {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Schedule</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">
            {header.start ? `Started ${dmy(header.start)}` : "Not started"}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setClosed(new Set())}>
            Expand all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setClosed(new Set(schedule.packages.map((p) => p.packageId)))}
          >
            Collapse all
          </Button>
        </div>
      </div>

      {schedule.packages.map((pkg) => {
        const isClosed = closed.has(pkg.packageId);
        return (
          <Card key={pkg.packageId} className="mb-3">
            <CardHeader
              className="cursor-pointer select-none hover:bg-muted/80"
              onClick={() => toggle(pkg.packageId)}
            >
              <span className="inline-grid place-items-center w-[18px] h-[18px] text-muted-foreground">
                <Icon
                  name="chevronRight"
                  className={`w-3.5 h-3.5 transition-transform ${isClosed ? "" : "rotate-90"}`}
                />
              </span>
              <h3>
                {String(pkg.seqNo).padStart(2, "0")} {pkg.packageName}
              </h3>
              <span className="text-muted-foreground text-sm">
                {pkg.taskCount ? `${pkg.taskCount} tasks · ${pkg.progressPct}%` : "No plan yet"}
              </span>
              <div className="ml-auto flex gap-2" onClick={(e) => e.stopPropagation()}>
                {canEdit && (
                  <OpenDialogButton
                    dialog={{ kind: "addTask", projectId, moduleId: pkg.packageId }}
                    size="sm"
                  >
                    <Icon name="plus" className="w-[15px] h-[15px]" />
                    Add Task
                  </OpenDialogButton>
                )}
              </div>
            </CardHeader>
            {!isClosed && (
              <Gantt
                projectId={projectId}
                packageId={pkg.packageId}
                phases={pkg.phases}
                projectStart={pkg.projectStart ?? ""}
                viewport={pkg.viewport}
                monthHeaders={pkg.monthHeaders}
                canEdit={canEdit}
              />
            )}
          </Card>
        );
      })}
    </div>
  );
}
