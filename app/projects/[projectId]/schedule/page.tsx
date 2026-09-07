"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { dmy, isClientRole, mno, progress } from "@/lib/logic";
import { Gantt } from "@/components/domain/Gantt";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export default function SchedulePage() {
  const params = useParams<{ projectId: string }>();
  const { data, role, openDialog } = useApp();
  const project = data.projects.find((p) => p.id === params.projectId)!;
  const client = isClientRole(role);

  const [closed, setClosed] = useState<Set<string>>(
    () => new Set(project.modules.filter((m) => !m.tasks.length).map((m) => m.id))
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
          <p className="mt-1 text-muted-foreground text-[13.5px]">{project.start ? `Started ${dmy(project.start)}` : "Not started"}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setClosed(new Set())}>
            Expand all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setClosed(new Set(project.modules.map((m) => m.id)))}>
            Collapse all
          </Button>
        </div>
      </div>

      {project.modules.map((m) => {
        const isClosed = closed.has(m.id);
        const taskCount = m.tasks.length;
        return (
          <Card key={m.id} className="mb-3">
            <CardHeader className="cursor-pointer select-none hover:bg-muted/80" onClick={() => toggle(m.id)}>
              <span className="inline-grid place-items-center w-[18px] h-[18px] text-muted-foreground">
                <Icon name="chevronRight" className={`w-3.5 h-3.5 transition-transform ${isClosed ? "" : "rotate-90"}`} />
              </span>
              <h3>
                {mno(project, m)} {m.name}
              </h3>
              <span className="text-muted-foreground text-sm">
                {taskCount ? `${taskCount} tasks · ${progress(m)}%` : "No plan yet"}
              </span>
              <div className="ml-auto flex gap-2" onClick={(e) => e.stopPropagation()}>
                {!client && (
                  <Button size="sm" onClick={() => openDialog({ kind: "addTask", projectId: project.id, moduleId: m.id })}>
                    <Icon name="plus" className="w-[15px] h-[15px]" />
                    Add Task
                  </Button>
                )}
              </div>
            </CardHeader>
            {!isClosed && <Gantt project={project} module={m} />}
          </Card>
        );
      })}
    </div>
  );
}
