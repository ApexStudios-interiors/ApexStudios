"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { useProject } from "@/hooks/useProject";
import { isClientRole, mno } from "@/lib/logic";
import { UpdateList } from "@/components/domain/UpdateList";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Empty } from "@/components/ui/Empty";

export default function UpdatesPage() {
  const { data, role, openDialog } = useApp();
  const project = useProject();
  const [filter, setFilter] = useState("all");

  const updates = data.updates.filter((u) => u.proj === project.id && (filter === "all" || u.mod === filter));

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Daily Updates</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">
            Work done on site, posted by the site supervisor.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {!isClientRole(role) && (
            <Button
              variant="primary"
              onClick={() => openDialog({ kind: "postUpdate", projectId: project.id })}
            >
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Post Update
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-9 border border-input rounded-lg bg-background px-2 text-[13px]"
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
        {updates.length ? <UpdateList project={project} updates={updates} /> : <Empty>No updates yet.</Empty>}
      </Card>
    </div>
  );
}
