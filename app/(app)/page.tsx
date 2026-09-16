import { requireSession } from "@/lib/auth/session";
import { getPortfolio } from "@/features/projects/queries";
import { StatBar } from "@/components/ui/StatBar";
import { ProjectCard } from "@/features/projects/components/ProjectCard";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { Icon } from "@/components/ui/Icon";
import { formatINRCompact } from "@/lib/money";

/**
 * build/04-projects-packages-phases.md §4.4 step 1. Server Component: reads
 * via getPortfolio, passes the DTO into ProjectCard as props. Dynamic by
 * virtue of requireSession()'s cookies() read (§4.6: no full-route caching —
 * this page is role-scoped, and a cached response would serve one role's
 * numbers to another).
 */
export default async function HomePage() {
  const session = await requireSession();
  const portfolio = await getPortfolio(session);

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">All Projects</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">{portfolio.projects.length} projects</p>
        </div>
        <div className="ml-auto flex gap-2">
          {portfolio.role === "money" && (
            <OpenDialogButton dialog={{ kind: "addProject" }} variant="primary">
              <Icon name="plus" className="w-[15px] h-[15px]" />
              New Project
            </OpenDialogButton>
          )}
        </div>
      </div>

      {portfolio.role === "money" ? (
        <StatBar
          stats={[
            {
              label: "Total Allocated",
              value: formatINRCompact(portfolio.stats.totalAllocated),
              sub: `Across ${portfolio.projects.length} projects`,
            },
            {
              label: "Total Internal",
              value: formatINRCompact(portfolio.stats.totalInternal),
              sub: `Margin ${formatINRCompact(Number(portfolio.stats.totalAllocated) - Number(portfolio.stats.totalInternal))}`,
            },
            { label: "Committed", value: formatINRCompact(portfolio.stats.committed), sub: "of internal" },
            {
              label: "Active Projects",
              value: portfolio.stats.activeProjects,
              sub: `of ${portfolio.projects.length}`,
            },
          ]}
        />
      ) : portfolio.role === "client" ? (
        <StatBar
          stats={[
            {
              label: "Total Contract Value",
              value: formatINRCompact(portfolio.stats.totalContractValue),
              sub: `Across ${portfolio.projects.length} projects`,
            },
            {
              label: "Active Projects",
              value: portfolio.stats.activeProjects,
              sub: `of ${portfolio.projects.length}`,
            },
            {
              label: "Awaiting Your Approval",
              value: portfolio.stats.awaitingApproval,
              sub: "samples & bills",
            },
          ]}
        />
      ) : (
        <StatBar
          stats={[
            {
              label: "Active Projects",
              value: portfolio.stats.activeProjects,
              sub: `of ${portfolio.projects.length}`,
            },
            {
              label: "Packages in Progress",
              value: portfolio.stats.packagesInProgress,
              sub: "across all projects",
            },
            { label: "Pending Requests", value: portfolio.stats.pendingRequests, sub: "awaiting approval" },
          ]}
        />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {portfolio.projects.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}
