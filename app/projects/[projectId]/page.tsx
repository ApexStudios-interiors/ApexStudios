"use client";

import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { useProject } from "@/hooks/useProject";
import {
  bills,
  billTotals,
  dmy,
  fmtS,
  isClientRole,
  isMoney,
  isSiteRole,
  projProgress,
  totals,
} from "@/lib/logic";
import { BudgetStatBar } from "@/components/domain/BudgetStatBar";
import { StatBar } from "@/components/ui/StatBar";
import { ModuleTable } from "@/components/domain/ModuleTable";
import { ApprovalTable } from "@/components/domain/ApprovalTable";
import { ReqTable } from "@/components/domain/ReqTable";
import { UpdateList } from "@/components/domain/UpdateList";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export default function ProjectDashboardPage() {
  const router = useRouter();
  const { data, role, openDialog } = useApp();
  const project = useProject();

  const t = totals(data, project);
  const pending = data.requests.filter((r) => r.proj === project.id && r.status === "Pending");
  const bs = bills(data, project.id);
  const billedNet = bs.filter((b) => b.status !== "Draft").reduce((a, b) => a + billTotals(b).net, 0);
  const paidNet = bs.filter((b) => b.status === "Paid").reduce((a, b) => a + billTotals(b).net, 0);
  const apPending = data.approvals.filter((a) => a.proj === project.id && a.status === "Pending");
  const updates = data.updates.filter((u) => u.proj === project.id).slice(0, 3);

  const money = isMoney(role);
  const client = isClientRole(role);
  const site = isSiteRole(role);

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{project.name}</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">
            {project.client} · {project.location}
            {project.start ? ` · Started ${dmy(project.start)}` : ""}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {money && (
            <Button onClick={() => openDialog({ kind: "addModule", projectId: project.id })}>
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Add Package
            </Button>
          )}
          {!client && (
            <Button
              variant="primary"
              onClick={() => openDialog({ kind: "newRequest", projectId: project.id })}
            >
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Stock Request
            </Button>
          )}
        </div>
      </div>

      {money || client ? (
        <BudgetStatBar
          role={role}
          alloc={t.alloc}
          int={t.int}
          c={t.c}
          prog={projProgress(project)}
          extraStats={[
            { label: "Bills Raised", value: fmtS(billedNet), sub: `incl. GST · ${fmtS(paidNet)} paid` },
            {
              label: "Awaiting Your Approval",
              value: apPending.length + bs.filter((b) => b.status === "Submitted").length,
              sub: `${apPending.length} samples · ${bs.filter((b) => b.status === "Submitted").length} bills`,
            },
          ]}
        />
      ) : (
        <StatBar
          stats={[
            {
              label: "Packages in Progress",
              value: project.modules.filter((m) => m.status === "In progress").length,
              sub: `of ${project.modules.length}`,
            },
            { label: "Pending Requests", value: pending.length, sub: "awaiting approval" },
            {
              label: "To Receive",
              value: data.requests.filter((r) => r.proj === project.id && r.status === "Ordered").length,
              sub: "ordered, not yet on site",
            },
          ]}
        />
      )}

      <Card>
        <CardHeader>
          <h3>Packages</h3>
        </CardHeader>
        <ModuleTable project={project} />
      </Card>

      {apPending.length > 0 && !site && (
        <Card className="mt-5">
          <CardHeader>
            <h3>Pending Approvals</h3>
            <div className="ml-auto flex gap-2 items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push(`/projects/${project.id}/approvals`)}
              >
                View all
              </Button>
            </div>
          </CardHeader>
          <ApprovalTable project={project} list={apPending} />
        </Card>
      )}

      {pending.length > 0 && !client && (
        <Card className="mt-5">
          <CardHeader>
            <h3>Pending Requests</h3>
            <div className="ml-auto flex gap-2 items-center">
              <Button variant="ghost" size="sm" onClick={() => router.push(`/projects/${project.id}/stock`)}>
                View all
              </Button>
            </div>
          </CardHeader>
          <ReqTable project={project} reqs={pending} />
        </Card>
      )}

      {updates.length > 0 && (
        <Card className="mt-5">
          <CardHeader>
            <h3>Latest Updates</h3>
            <div className="ml-auto flex gap-2 items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push(`/projects/${project.id}/updates`)}
              >
                View all
              </Button>
            </div>
          </CardHeader>
          <UpdateList project={project} updates={updates} />
        </Card>
      )}
    </div>
  );
}
