import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getProjectHeader } from "@/features/projects/queries";
import { getProjectInventory } from "@/features/inventory/queries";
import { InventoryTable } from "@/features/inventory/components/InventoryTable";
import { formatINRCompact } from "@/lib/money";
import { StatBar } from "@/components/ui/StatBar";
import { Card } from "@/components/ui/Card";

/**
 * build/07-stock-inventory-notifications.md §2.5 step 3. `getProjectInventory`
 * already returns `EMPTY_STATS`/`[]` for a Client session (no route hidden
 * here — the sidebar link is absent, same soft-hide as every other role-gated
 * page in this app; `rpc_inventory_stats` and the role-scoped views are the
 * real boundary, not this page).
 */
export default async function InventoryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await requireSession();

  const header = await getProjectHeader(session, projectId);
  if (!header) notFound();

  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";

  const { items, stats } = await getProjectInventory(session, projectId);

  return (
    <div>
      <div className="mb-[22px]">
        <h1 className="text-[26px] font-bold tracking-tight">Inventory</h1>
        <p className="mt-1 text-muted-foreground text-[13.5px]">Material on hand at site.</p>
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

      <Card>
        <InventoryTable items={items} isAdmin={isAdmin} />
      </Card>
    </div>
  );
}
