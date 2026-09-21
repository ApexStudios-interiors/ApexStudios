import { requireSession } from "@/lib/auth/session";
import { getBusinessInventory } from "@/features/inventory/queries";
import { getPortfolio } from "@/features/projects/queries";
import { InventoryTable } from "@/features/inventory/components/InventoryTable";
import { InventoryProjectFilterSelect } from "@/features/inventory/components/InventoryProjectFilterSelect";
import { InventorySearchInput } from "@/features/inventory/components/InventorySearchInput";
import { normalizeInventorySearch } from "@/features/inventory/service";
import { formatINRCompact } from "@/lib/money";
import { parsePageRequest } from "@/lib/pagination";
import { StatBar } from "@/components/ui/StatBar";
import { Card } from "@/components/ui/Card";
import { TablePagination } from "@/components/shared/TablePagination";

/**
 * build/07-stock-inventory-notifications.md §2.5 step 3: business-wide —
 * adds the Project column and a project filter, keeps its ALL sidebar tag
 * (unchanged, no code here). `getBusinessInventory` returns `EMPTY_STATS`/an
 * empty page for a Client session, same non-hidden-route pattern as the
 * project-level page.
 *
 * Both toolbar controls are URL state (`project`, `q`) read here and applied
 * inside the Supabase query, so they compose with each other and with the
 * `page`/`pageSize` params, survive a reload, and can be linked to. The stat
 * row follows the same project AND search: `rpc_inventory_stats` takes both —
 * see `features/inventory/queries.ts`.
 */
export default async function BusinessInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; q?: string; page?: string; pageSize?: string }>;
}) {
  const { project: projectId, q, ...paging } = await searchParams;
  const session = await requireSession();

  const search = normalizeInventorySearch(q);

  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";

  const [{ items, stats }, portfolio] = await Promise.all([
    getBusinessInventory(session, { projectId, search }, parsePageRequest(paging)),
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
          { label: "Low Stock", value: stats.lowCount, sub: "below minimum stock" },
          { label: "Critical", value: stats.criticalCount, sub: "out of stock" },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <InventoryProjectFilterSelect projects={portfolio.projects} value={projectId ?? ""} />
        <InventorySearchInput value={search ?? ""} />
      </div>

      <Card>
        <InventoryTable
          items={items.rows}
          isAdmin={isAdmin}
          showProject
          empty={search ? `No items match “${search}”.` : undefined}
        />
        <TablePagination page={items.page} pageSize={items.pageSize} total={items.total} />
      </Card>
    </div>
  );
}
