import Link from "next/link";
import type { ProjectCardDTO } from "@/features/projects/queries";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatINRCompact } from "@/lib/money";
import { dmy } from "@/lib/format";
import { plural } from "@/lib/plural";
import { projectPath } from "@/lib/routing/paths";
import {
  AGED_APPROVAL_DAYS,
  STALE_UPDATE_DAYS,
  daysAgoLabel,
  type ProjectAttention,
} from "@/features/projects/portfolio";

/**
 * Props instead of `useApp()` (build/04-projects-packages-phases.md §4.4 step
 * 1). `budgetUsedPct` is `null` for anyone but admin — its own presence is the
 * money gate, not a role check re-derived here. The same goes for
 * `attention.outstanding` (admin only) and `attention.lowStock` (never a
 * client): `getPortfolioAttention` sets them to null for a role that must not
 * see them, so this component only ever renders what it was given.
 */
export function ProjectCard({
  project,
  attention,
}: {
  project: ProjectCardDTO;
  /** APX-48. Omitted where a caller has none — the card then reads as before. */
  attention?: ProjectAttention;
}) {
  const bud = project.budgetUsedPct;
  const live = project.status !== "Completed" && project.status !== "Archived";

  return (
    <Link href={projectPath({ code: project.code })} className="block">
      <Card className="p-[22px] cursor-pointer flex flex-col gap-4 hover:border-foreground transition-colors h-full">
        <div className="flex items-start gap-3">
          <div className="min-w-0">
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

        {attention && live && <AttentionBadges attention={attention} />}

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

        <div className="text-xs text-muted-foreground pt-0.5 mt-auto">
          {plural(project.packageCount, "package")} ·{" "}
          {project.headlineAmount != null ? formatINRCompact(project.headlineAmount) : "–"}{" "}
          {bud != null ? "allocated" : "contract"}
          {project.start ? ` · Started ${dmy(project.start)}` : " · Not started"}
          {attention && live && (
            <div className="mt-1">
              {attention.lastUpdateDays == null ? (
                "No recent site update"
              ) : (
                <>
                  Last site update {daysAgoLabel(attention.lastUpdateDays)}
                  {attention.lastUpdateDays >= STALE_UPDATE_DAYS && (
                    <span className="font-semibold text-foreground"> · overdue</span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

/** Only what needs looking at — a calm project shows no badges at all, so the
 *  ones that do show stand out. Each carries its meaning in words, never in
 *  colour alone. */
function AttentionBadges({ attention: a }: { attention: ProjectAttention }) {
  const aged = a.oldestApprovalDays != null && a.oldestApprovalDays >= AGED_APPROVAL_DAYS;
  const items = [
    a.lateTasks > 0 && (
      <Badge key="late" variant="destructive">
        {plural(a.lateTasks, "late task")}
      </Badge>
    ),
    a.pendingApprovals > 0 && (
      <Badge key="approvals" variant={aged ? "warning" : "outline"}>
        {plural(a.pendingApprovals, "approval")} pending
        {a.oldestApprovalDays != null && a.oldestApprovalDays > 0 ? ` · oldest ${a.oldestApprovalDays}d` : ""}
      </Badge>
    ),
    a.outstanding != null && a.outstanding > 0 && (
      <Badge key="outstanding" variant="outline">
        {formatINRCompact(a.outstanding)} outstanding
      </Badge>
    ),
    a.lowStock != null && a.lowStock > 0 && (
      <Badge key="stock" variant="warning">
        {plural(a.lowStock, "item")} low on stock
      </Badge>
    ),
  ].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div role="group" className="flex flex-wrap gap-1.5" aria-label="Needs attention">
      {items}
    </div>
  );
}
