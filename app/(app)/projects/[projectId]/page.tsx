import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getClientBillingStats, getProjectHeader, getSiteStockStats } from "@/features/projects/queries";
import { getPackagesForProject, type PackagesForProject } from "@/features/packages/queries";
import { getUpdatesForProject } from "@/features/updates/queries";
import { getStockRequestsForProject } from "@/features/stock/queries";
import { getApprovalsForProject } from "@/features/approvals/queries";
import { BudgetStatBar } from "@/features/billing/components/BudgetStatBar";
import { StatBar } from "@/components/ui/StatBar";
import { ModuleTable } from "@/features/packages/components/ModuleTable";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { LegacyDashboardCards } from "./LegacyDashboardCards";
import { dmy } from "@/lib/logic";
import { formatINRCompact } from "@/lib/money";

/**
 * build/04-projects-packages-phases.md §4.4 step 2. Stat row and Packages
 * table come from the database. Pending Approvals, Pending Requests and
 * Latest Updates are all real data as of build/08-approvals.md — the last of
 * the three off `AppContext` — fetched here and passed down as props.
 * `LegacyDashboardCards` stays a client boundary only because "View all"
 * needs `router.push`, not because anything on it is still mock.
 */
export default async function ProjectDashboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await requireSession();

  const header = await getProjectHeader(session, projectId);
  if (!header) notFound();

  const packages = await getPackagesForProject(session, projectId);
  const { items: latestUpdates } = await getUpdatesForProject(session, projectId);
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isMoney = effectiveRole === "owner" || effectiveRole === "admin";
  const isClient = effectiveRole === "client";
  // 01-hld.md §7.1: Client has no stock visibility at all — the query itself
  // isn't even worth running for that role.
  const pendingRequests = isClient
    ? []
    : (await getStockRequestsForProject(session, projectId, { status: "pending" })).slice(0, 5);
  const pendingApprovals = (await getApprovalsForProject(session, projectId, { status: "pending" })).slice(
    0,
    5
  );

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
        <ClientDashboardStats
          projectId={projectId}
          alloc={packages.totals.allocated}
          prog={header.progressPct}
        />
      ) : (
        <SiteDashboardStats projectId={projectId} packages={packages} />
      )}

      <Card>
        <CardHeader>
          <h3>Packages</h3>
        </CardHeader>
        <ModuleTable projectId={projectId} data={packages} projectProgressPct={header.progressPct} />
      </Card>

      <LegacyDashboardCards
        projectId={projectId}
        isClient={isClient}
        isSite={!isMoney && !isClient}
        isAdmin={isMoney}
        role={effectiveRole}
        pendingApprovals={pendingApprovals}
        pendingRequests={pendingRequests}
        updates={latestUpdates.slice(0, 3)}
      />
    </div>
  );
}

async function ClientDashboardStats({
  projectId,
  alloc,
  prog,
}: {
  projectId: string;
  alloc: number;
  prog: number;
}) {
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
