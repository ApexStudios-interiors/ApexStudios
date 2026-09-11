import { requireSession } from "@/lib/auth/session";
import { getBusinessInventory } from "@/features/inventory/queries";
import { getPortfolio } from "@/features/projects/queries";
import { InventoryTable } from "@/components/domain/InventoryTable";
import { InventoryProjectFilterSelect } from "@/components/domain/InventoryProjectFilterSelect";
import { formatINRCompact } from "@/lib/money";
import { StatBar } from "@/components/ui/StatBar";
import { Card } from "@/components/ui/Card";

/**
 * build/07-stock-inventory-notifications.md §2.5 step 3: business-wide —
 * adds the Project column and a project filter, keeps its ALL sidebar tag
 * (unchanged, no code here). `getBusinessInventory` returns `EMPTY_STATS`/`[]`
 * for a Client session, same non-hidden-route pattern as the project-level
 * page.
 */
export default async function BusinessInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project: projectId } = await searchParams;
  const session = await requireSession();

  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";

  const [{ items, stats }, portfolio] = await Promise.all([
    getBusinessInventory(session, { projectId }),
    getPortfolio(session),
  ]);

  return (
    <div>
      <div className="mb-[22px]">
        <h1 className="text-[26px] font-bold tracking-tight">Inventory</h1>
        <p className="mt-1 text-muted-foreground text-[13.5px]">Material on hand across every project.</p>
      </div>

      <StatBar
        stats={[
          { label: "Total Items", value: stats.totalItems },
          ...(isAdmin
            ? [{ label: "Total Value", value: formatINRCompact(stats.totalValue ?? 0), sub: "at unit cost" }]
            : []),
          { label: "Low Stock", value: stats.lowCount, sub: "below reorder level" },
          { label: "Critical", value: stats.criticalCount, sub: "out of stock" },
        ]}
      />

      <div className="flex gap-3 mb-4">
        <InventoryProjectFilterSelect projects={portfolio.projects} value={projectId ?? ""} />
      </div>

      <Card>
        <InventoryTable items={items} isAdmin={isAdmin} showProject />
      </Card>
    </div>
  );
}
