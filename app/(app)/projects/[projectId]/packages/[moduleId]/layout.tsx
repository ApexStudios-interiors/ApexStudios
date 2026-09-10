import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getPackageDetail } from "@/features/packages/queries";
import { BudgetStatBar } from "@/components/domain/BudgetStatBar";
import { LinkTabs } from "@/components/ui/LinkTabs";
import { PackageDetailActions } from "./PackageDetailActions";

/**
 * The header, stat row and tab bar shared by every tab route (ui-guide.md
 * §6.5) — the package-detail counterpart of the project dashboard's own
 * Server Component conversion. Only the Budget/Phases tab (`./budget/`) reads
 * real data for its BODY in this build; Schedule, Updates, Stock and Billing
 * stay on AppContext until Builds 05-09, but the chrome around all five is
 * real from this build on.
 */
export default async function PackageDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string; moduleId: string }>;
}) {
  const { projectId, moduleId } = await params;
  const session = await requireSession();

  const detail = await getPackageDetail(session, projectId, moduleId);
  if (!detail) notFound();

  const effectiveRole = session.impersonating?.role ?? session.role;
  const isMoney = effectiveRole === "owner" || effectiveRole === "admin";
  const isClient = effectiveRole === "client";
  const base = `/projects/${projectId}/packages/${moduleId}`;

  const tabs = [
    { key: "budget", label: isMoney ? "Budget" : "Phases", href: `${base}/budget` },
    { key: "schedule", label: "Schedule", href: `${base}/schedule` },
    { key: "updates", label: "Updates", href: `${base}/updates` },
    ...(isClient ? [] : [{ key: "stock", label: "Stock Requests", href: `${base}/stock` }]),
    ...(isMoney ? [{ key: "billing", label: "Billing", href: `${base}/billing` }] : []),
  ];

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">
            <span className="inline-block min-w-[24px] mr-1.5 text-muted-foreground tabular-nums font-medium text-lg align-middle">
              {String(detail.seqNo).padStart(2, "0")}
            </span>
            {detail.name}
          </h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">
            {detail.lead} · {detail.statusLabel} · {detail.progressPct}% complete
          </p>
        </div>
        <PackageDetailActions projectId={projectId} moduleId={moduleId} isMoney={isMoney} isClient={isClient} />
      </div>

      {/* ui-guide.md §6.5: "Site sees no stat row here — straight to the tabs." */}
      {detail.role === "money" && (
        <BudgetStatBar
          role="money"
          alloc={detail.allocated}
          int={detail.internal}
          c={detail.committed}
          prog={detail.progressPct}
        />
      )}
      {detail.role === "client" && (
        <BudgetStatBar role="client" alloc={detail.contractValue} int={0} c={0} prog={detail.progressPct} />
      )}

      <LinkTabs items={tabs} />

      {children}
    </div>
  );
}
