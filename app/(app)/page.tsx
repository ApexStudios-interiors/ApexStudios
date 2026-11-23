import { requireSession } from "@/lib/auth/session";
import { getPortfolio, getPortfolioAttention } from "@/features/projects/queries";
import { ProjectListFilters } from "@/features/projects/components/ProjectListFilters";
import {
  filterProjects,
  normaliseProjectSearch,
  parseProjectStatusFilter,
  sortByAttention,
} from "@/features/projects/portfolio";
import { plural } from "@/lib/plural";
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
 *
 * APX-48/51: cards are sorted by what needs attention (late tasks, waiting
 * approvals, outstanding money for admin, low stock, a quiet site) and carry
 * badges saying so; a status filter (archived hidden by default) and a search
 * narrow them. The stat row still describes the whole portfolio.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status: rawStatus, q: rawQ } = await searchParams;
  const status = parseProjectStatusFilter(rawStatus);
  const q = normaliseProjectSearch(rawQ);
  const session = await requireSession();
  const portfolio = await getPortfolio(session);
  const attention = await getPortfolioAttention(
    session,
    portfolio.projects.map((p) => p.id)
  );
  const shown = sortByAttention(filterProjects(portfolio.projects, { status, q }), attention);
  const total = portfolio.projects.length;

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">All Projects</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">
            {shown.length === total
              ? plural(total, "project")
              : `${shown.length} of ${plural(total, "project")}`}
          </p>
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
              sub: `Across ${plural(total, "project")}`,
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
              sub: `Across ${plural(total, "project")}`,
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

      <ProjectListFilters status={status} q={q} />

      {shown.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
          {shown.map((p) => (
            <ProjectCard key={p.id} project={p} attention={attention[p.id]} />
          ))}
        </div>
      ) : (
        <div className="rounded-[10px] border border-dashed border-border px-5 py-10 text-center text-muted-foreground text-[13.5px]">
          {total === 0
            ? "No projects yet."
            : q
              ? `No projects match “${q}”.`
              : "No projects with this status."}
        </div>
      )}
    </div>
  );
}
