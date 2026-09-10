"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { useProject } from "@/hooks/useProject";
import { isClientRole } from "@/lib/logic";
import { ApprovalTable } from "@/components/domain/ApprovalTable";
import { Card } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

const FILTERS = ["Pending", "Approved", "Rejected", "All"];

export default function ApprovalsPage() {
  const { data, role, openDialog } = useApp();
  const project = useProject();
  const client = isClientRole(role);
  const [filter, setFilter] = useState("Pending");

  const all = data.approvals.filter((a) => a.proj === project.id);
  const list = filter === "All" ? all : all.filter((a) => a.status === filter);

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Approvals</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">
            {client
              ? "Samples, makes and drawings waiting for your sign-off."
              : "Client sign-offs on samples, makes and drawings."}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {!client && (
            <Button
              variant="primary"
              onClick={() => openDialog({ kind: "newApproval", projectId: project.id })}
            >
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Request Approval
            </Button>
          )}
        </div>
      </div>

      <Tabs items={FILTERS.map((s) => ({ key: s, label: s }))} value={filter} onChange={setFilter} />

      <Card>
        <ApprovalTable project={project} list={list} />
      </Card>
    </div>
  );
}
