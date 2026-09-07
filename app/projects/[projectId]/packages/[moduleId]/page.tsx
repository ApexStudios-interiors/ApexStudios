"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { committed, isClientRole, isMoney, mno, progress } from "@/lib/logic";
import { BudgetStatBar } from "@/components/domain/BudgetStatBar";
import { PhaseTable } from "@/components/domain/PhaseTable";
import { Gantt } from "@/components/domain/Gantt";
import { ReqTable } from "@/components/domain/ReqTable";
import { MilestoneTable } from "@/components/domain/MilestoneTable";
import { UpdateList } from "@/components/domain/UpdateList";
import { Card } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Empty } from "@/components/ui/Empty";

type Tab = "budget" | "schedule" | "updates" | "stock" | "billing";

export default function ModuleDetailPage() {
  const params = useParams<{ projectId: string; moduleId: string }>();
  const { data, role, openDialog } = useApp();
  const project = data.projects.find((p) => p.id === params.projectId)!;
  const mod = project.modules.find((x) => x.id === params.moduleId)!;
  const [tab, setTab] = useState<Tab>("budget");

  const money = isMoney(role);
  const client = isClientRole(role);
  const c = committed(data, project.id, mod);
  const reqs = data.requests.filter((r) => r.proj === project.id && r.mod === mod.id);
  const updates = data.updates.filter((u) => u.proj === project.id && u.mod === mod.id);

  const tabItems = [
    { key: "budget", label: money ? "Budget" : "Phases" },
    { key: "schedule", label: "Schedule" },
    { key: "updates", label: "Updates" },
    ...(client ? [] : [{ key: "stock", label: "Stock Requests" }]),
    ...(money ? [{ key: "billing", label: "Billing" }] : []),
  ];

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">
            <span className="inline-block min-w-[24px] mr-1.5 text-muted-foreground tabular-nums font-medium text-lg align-middle">
              {mno(project, mod)}
            </span>
            {mod.name}
          </h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">
            {mod.lead} · {mod.status} · {progress(mod)}% complete
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {money && (
            <Button onClick={() => openDialog({ kind: "editModule", projectId: project.id, moduleId: mod.id })}>Edit</Button>
          )}
          {tab === "schedule" && !client && (
            <Button onClick={() => openDialog({ kind: "addTask", projectId: project.id, moduleId: mod.id })}>
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Add Task
            </Button>
          )}
          {tab === "updates" && !client && (
            <Button onClick={() => openDialog({ kind: "postUpdate", projectId: project.id, moduleId: mod.id })}>
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Post Update
            </Button>
          )}
          {!client && (
            <Button variant="primary" onClick={() => openDialog({ kind: "newRequest", projectId: project.id, moduleId: mod.id })}>
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Stock Request
            </Button>
          )}
        </div>
      </div>

      <BudgetStatBar role={role} alloc={mod.allocated} int={mod.internal} c={c} prog={progress(mod)} />

      <Tabs items={tabItems} value={tab} onChange={(k) => setTab(k as Tab)} />

      {tab === "budget" && (
        <Card>
          <PhaseTable project={project} module={mod} />
        </Card>
      )}
      {tab === "schedule" && (
        <Card>
          <Gantt project={project} module={mod} />
        </Card>
      )}
      {tab === "stock" && (
        <Card>
          <ReqTable project={project} reqs={reqs} moduleContext />
        </Card>
      )}
      {tab === "billing" && <MilestoneTable project={project} module={mod} />}
      {tab === "updates" && <Card>{updates.length ? <UpdateList project={project} updates={updates} /> : <Empty>No updates yet.</Empty>}</Card>}
    </div>
  );
}
