import { notFound, forbidden } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getProjectHeader } from "@/features/projects/queries";
import { getProjectInventory } from "@/features/inventory/queries";
import { InventoryTable } from "@/features/inventory/components/InventoryTable";
import { formatINRCompact } from "@/lib/money";
import { parsePageRequest } from "@/lib/pagination";
import { StatBar } from "@/components/ui/StatBar";
import { Card } from "@/components/ui/Card";
import { TablePagination } from "@/components/shared/TablePagination";
import { parseInventoryStatusFilter } from "@/features/inventory/service";
import { InventoryStatusTabs } from "@/features/inventory/components/InventoryStatusTabs";
import { StatusTileLink } from "@/features/inventory/components/StatusTileLink";
import { projectBase } from "@/lib/routing/current";

/**
 * build/07-stock-inventory-notifications.md §2.5 step 3. `getProjectInventory`
 * already returns `EMPTY_STATS`/an empty page for a Client session (no route
 * hidden here — the sidebar link is absent, same soft-hide as every other
 * role-gated page in this app; `rpc_inventory_stats` and the role-scoped
 * views are the real boundary, not this page).
 */
export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ status?: string; page?: string; pageSize?: string }>;
}) {
  const { projectId } = await params;
  const { status: rawStatus, ...paging } = await searchParams;
  const status = parseInventoryStatusFilter(rawStatus);
  const session = await requireSession();

  const header = await getProjectHeader(session, projectId);
  if (!header) notFound();

  const effectiveRole = session.impersonating?.role ?? session.role;
  // HLD §7.1: a client has no stock or inventory surface. The sidebar hides the
  // link; this is the hard guard for a typed or shared URL, matching /stock
  // (APX-68, found live — the page used to open with an empty table).
  if (effectiveRole === "client") forbidden();
  const isAdmin = effectiveRole === "admin";

  const { items, stats } = await getProjectInventory(session, projectId, parsePageRequest(paging), status);
  const basePath = `${await projectBase(projectId)}/inventory`;

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
          {
            label: "Low Stock",
            value: (
              <StatusTileLink
                href={`${basePath}?status=low`}
                count={stats.lowCount}
                label="low-stock items"
              />
            ),
            sub: "below minimum stock",
          },
          {
            label: "Critical",
            value: (
              <StatusTileLink
                href={`${basePath}?status=critical`}
                count={stats.criticalCount}
                label="out-of-stock items"
              />
            ),
            sub: "out of stock",
          },
        ]}
      />

      <InventoryStatusTabs status={status ?? ""} />

      <Card>
        <InventoryTable
          items={items.rows}
          isAdmin={isAdmin}
          empty={status ? `No ${status === "low" ? "low-stock" : "out-of-stock"} items.` : undefined}
        />
        <TablePagination page={items.page} pageSize={items.pageSize} total={items.total} />
      </Card>
    </div>
  );
}
