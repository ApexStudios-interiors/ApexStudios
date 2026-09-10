import Link from "next/link";
import type { ProjectCardDTO } from "@/features/projects/queries";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatINRCompact } from "@/lib/money";
import { dmy } from "@/lib/logic";

/**
 * Props instead of `useApp()` (build/04-projects-packages-phases.md §4.4 step
 * 1). `budgetUsedPct` is `null` for anyone but admin — its own presence is the
 * money gate, not a role check re-derived here.
 */
export function ProjectCard({ project }: { project: ProjectCardDTO }) {
  const bud = project.budgetUsedPct;

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
              <b className="text-foreground font-semibold">{project.progressPct}%</b>
            </div>
            <div className="progress-track">
              <i style={{ width: `${project.progressPct}%` }} />
            </div>
          </div>
          {bud != null && (
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
          {project.packageCount} packages ·{" "}
          {project.headlineAmount != null ? formatINRCompact(project.headlineAmount) : "–"}{" "}
          {bud != null ? "allocated" : "contract"}
          {project.start ? ` · Started ${dmy(project.start)}` : " · Not started"}
        </div>
      </Card>
    </Link>
  );
}
