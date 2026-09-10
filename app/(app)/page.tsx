"use client";

import { useApp } from "@/context/AppContext";
import { fmtS, isClientRole, isMoney, pct, totals } from "@/lib/logic";
import { StatBar } from "@/components/ui/StatBar";
import { ProjectCard } from "@/components/domain/ProjectCard";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export default function HomePage() {
  const { data, role, openDialog } = useApp();
  const money = isMoney(role);
  const client = isClientRole(role);

  const t0 = data.projects.reduce(
    (a, p) => {
      const t = totals(data, p);
      a.alloc += t.alloc;
      a.int += t.int;
      a.c += t.c;
      return a;
    },
    { alloc: 0, int: 0, c: 0 }
  );
  const active = data.projects.filter((p) => p.status === "Active").length;
  const apPendAll = data.approvals.filter((a) => a.status === "Pending").length;
  const billsPendAll = data.bills.filter((b) => b.status === "Submitted").length;
  const stockPendAll = data.requests.filter((r) => r.status === "Pending").length;
  const inProgAll = data.projects.reduce(
    (a, p) => a + p.modules.filter((m) => m.status === "In progress").length,
    0
  );

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">All Projects</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">{data.projects.length} projects</p>
        </div>
        <div className="ml-auto flex gap-2">
          {money && (
            <Button variant="primary" onClick={() => openDialog({ kind: "addProject" })}>
              <Icon name="plus" className="w-[15px] h-[15px]" />
              New Project
            </Button>
          )}
        </div>
      </div>

      {money ? (
        <StatBar
          stats={[
            {
              label: "Total Allocated",
              value: fmtS(t0.alloc),
              sub: `Across ${data.projects.length} projects`,
            },
            { label: "Total Internal", value: fmtS(t0.int), sub: `Margin ${fmtS(t0.alloc - t0.int)}` },
            { label: "Committed", value: fmtS(t0.c), sub: `${pct(t0.c, t0.int)}% of internal` },
            { label: "Active Projects", value: active, sub: `of ${data.projects.length}` },
          ]}
        />
      ) : client ? (
        <StatBar
          stats={[
            {
              label: "Total Contract Value",
              value: fmtS(t0.alloc),
              sub: `Across ${data.projects.length} projects`,
            },
            { label: "Active Projects", value: active, sub: `of ${data.projects.length}` },
            {
              label: "Awaiting Your Approval",
              value: apPendAll + billsPendAll,
              sub: `${apPendAll} samples · ${billsPendAll} bills`,
            },
          ]}
        />
      ) : (
        <StatBar
          stats={[
            { label: "Active Projects", value: active, sub: `of ${data.projects.length}` },
            { label: "Packages in Progress", value: inProgAll, sub: "across all projects" },
            { label: "Pending Requests", value: stockPendAll, sub: "awaiting approval" },
          ]}
        />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {data.projects.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}
