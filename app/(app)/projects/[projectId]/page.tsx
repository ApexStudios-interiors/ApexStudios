import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getClientBillingStats, getProjectHeader, getSiteStockStats } from "@/features/projects/queries";
import { getPackagesForProject, type PackagesForProject } from "@/features/packages/queries";
import { BudgetStatBar } from "@/components/domain/BudgetStatBar";
import { StatBar } from "@/components/ui/StatBar";
import { ModuleTable } from "@/components/domain/ModuleTable";
import { OpenDialogButton } from "@/components/domain/OpenDialogButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { LegacyDashboardCards } from "./LegacyDashboardCards";
import { dmy } from "@/lib/logic";
import { formatINRCompact } from "@/lib/money";

/**
 * build/04-projects-packages-phases.md §4.4 step 2. Stat row and Packages
 * table come from the database. `LegacyDashboardCards` is the one client
 * boundary left on this page — Pending Approvals, Pending Requests and Latest
 * Updates still read AppContext (TODO(build-07): Approvals off AppContext.
 * TODO(build-08): Stock Requests and Daily Updates off AppContext) — a Server
 * Component can render a Client Component directly, so the rest of this page
 * stays server-rendered around it.
 */
export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await requireSession();

  const header = await getProjectHeader(session, projectId);
  if (!header) notFound();

  const packages = await getPackagesForProject(session, projectId);
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isMoney = effectiveRole === "owner" || effectiveRole === "admin";
  const isClient = effectiveRole === "client";

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{header.name}</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">
            {header.client} · {header.location}
            {header.start ? ` · Started ${dmy(header.start)}` : ""}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {isMoney && (
            <OpenDialogButton dialog={{ kind: "addModule", projectId }}>
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Add Package
            </OpenDialogButton>
          )}
          {!isClient && (
            <OpenDialogButton dialog={{ kind: "newRequest", projectId }} variant="primary">
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Stock Request
            </OpenDialogButton>
          )}
        </div>
      </div>

      {packages.role === "money" ? (
        <BudgetStatBar
          role="money"
          alloc={packages.totals.allocated}
          int={packages.totals.internal}
          c={packages.totals.committed}
          prog={header.progressPct}
        />
      ) : packages.role === "client" ? (
        <ClientDashboardStats projectId={projectId} alloc={packages.totals.allocated} prog={header.progressPct} />
      ) : (
        <SiteDashboardStats projectId={projectId} packages={packages} />
      )}

      <Card>
        <CardHeader>
          <h3>Packages</h3>
        </CardHeader>
        <ModuleTable projectId={projectId} data={packages} projectProgressPct={header.progressPct} />
      </Card>

      <LegacyDashboardCards projectId={projectId} isClient={isClient} isSite={!isMoney && !isClient} />
    </div>
  );
}

async function ClientDashboardStats({ projectId, alloc, prog }: { projectId: string; alloc: number; prog: number }) {
  const { billedNet, paidNet, billsSubmitted, approvalsPending } = await getClientBillingStats(projectId);
  return (
    <BudgetStatBar
      role="client"
      alloc={alloc}
      int={0}
      c={0}
      prog={prog}
      extraStats={[
        {
          label: "Bills Raised",
          value: formatINRCompact(billedNet),
          sub: `incl. GST · ${formatINRCompact(paidNet)} paid`,
        },
        {
          label: "Awaiting Your Approval",
          value: approvalsPending + billsSubmitted,
          sub: `${approvalsPending} samples · ${billsSubmitted} bills`,
        },
      ]}
    />
  );
}

async function SiteDashboardStats({
  projectId,
  packages,
}: {
  projectId: string;
  packages: Extract<PackagesForProject, { role: "site" }>;
}) {
  const { pendingRequests, toReceive } = await getSiteStockStats(projectId);
  const inProgress = packages.packages.filter((p) => p.status === "in_progress").length;
  return (
    <StatBar
      stats={[
        { label: "Packages in Progress", value: inProgress, sub: `of ${packages.packages.length}` },
        { label: "Pending Requests", value: pendingRequests, sub: "awaiting approval" },
        { label: "To Receive", value: toReceive, sub: "ordered, not yet on site" },
      ]}
    />
  );
}
