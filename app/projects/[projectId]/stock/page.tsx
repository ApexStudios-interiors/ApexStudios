"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { mno } from "@/lib/logic";
import { FLOW } from "@/lib/data";
import { ReqTable } from "@/components/domain/ReqTable";
import { Card } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

const FILTERS = ["All", ...FLOW, "Rejected"];

export default function StockPage() {
  const params = useParams<{ projectId: string }>();
  const { data, openDialog } = useApp();
  const project = data.projects.find((p) => p.id === params.projectId)!;
  const [filter, setFilter] = useState("All");
  const [modFilter, setModFilter] = useState("all");

  const all = data.requests.filter((r) => r.proj === project.id && (modFilter === "all" || r.mod === modFilter));
  const reqs = filter === "All" ? all : all.filter((r) => r.status === filter);

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Stock Requests</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">{all.filter((r) => r.status === "Pending").length} pending</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="primary" onClick={() => openDialog({ kind: "newRequest", projectId: project.id })}>
            <Icon name="plus" className="w-[15px] h-[15px]" />
            New Request
          </Button>
        </div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <Tabs items={FILTERS.map((s) => ({ key: s, label: s }))} value={filter} onChange={setFilter} />
        <select
          value={modFilter}
          onChange={(e) => setModFilter(e.target.value)}
          className="h-9 border border-input rounded-lg bg-background px-2 text-[13px] mb-4"
        >
          <option value="all">All packages</option>
          {project.modules.map((m) => (
            <option key={m.id} value={m.id}>
              {mno(project, m)} {m.name}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <ReqTable project={project} reqs={reqs} />
      </Card>
    </div>
  );
}
