"use client";

import Link from "next/link";
import { useApp } from "@/context/AppContext";
import type { Project } from "@/lib/types";
import { dmy, fmtS, isMoney, pct, projProgress, totals } from "@/lib/logic";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export function ProjectCard({ project }: { project: Project }) {
  const { data, role } = useApp();
  const t = totals(data, project);
  const prog = projProgress(project);
  const bud = pct(t.c, t.int);
  const money = isMoney(role);

  return (
    <Link href={`/projects/${project.id}`} className="block">
      <Card className="p-[22px] cursor-pointer flex flex-col gap-4 hover:border-foreground transition-colors">
        <div className="flex items-start gap-3">
          <div>
            <h3 className="text-base font-bold tracking-tight">{project.name}</h3>
            <div className="text-muted-foreground text-sm">{project.client}</div>
          </div>
          <Badge
            variant={project.status === "Active" ? "default" : "secondary"}
            className="ml-auto flex-none"
          >
            {project.status}
          </Badge>
        </div>

        <div className="flex flex-col gap-[11px]">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span>Progress</span>
              <b className="text-foreground font-semibold">{prog}%</b>
            </div>
            <div className="progress-track">
              <i style={{ width: `${prog}%` }} />
            </div>
          </div>
          {money && (
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                <span>Budget used</span>
                <b className="text-foreground font-semibold">
                  {bud}%{bud > 100 && <b className="flag">over</b>}
                </b>
              </div>
              <div className="progress-track">
                <i className={bud > 100 ? "over" : ""} style={{ width: `${Math.min(100, bud)}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground pt-0.5">
          {project.modules.length} packages · {fmtS(t.alloc)} {money ? "allocated" : "contract"}
          {project.start ? ` · Started ${dmy(project.start)}` : " · Not started"}
        </div>
      </Card>
    </Link>
  );
}
