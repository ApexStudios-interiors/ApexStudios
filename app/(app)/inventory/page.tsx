import { forbidden } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getBusinessInventory } from "@/features/inventory/queries";
import { getPortfolio } from "@/features/projects/queries";
import { InventoryTable } from "@/features/inventory/components/InventoryTable";
import { InventoryProjectFilterSelect } from "@/features/inventory/components/InventoryProjectFilterSelect";
import { InventorySearchInput } from "@/features/inventory/components/InventorySearchInput";
import { normalizeInventorySearch, parseInventoryStatusFilter } from "@/features/inventory/service";
import { InventoryStatusTabs } from "@/features/inventory/components/InventoryStatusTabs";
import { StatusTileLink } from "@/features/inventory/components/StatusTileLink";
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
  searchParams: Promise<{ project?: string; q?: string; status?: string; page?: string; pageSize?: string }>;
}) {
  const { project: projectId, q, status: rawStatus, ...paging } = await searchParams;
  const status = parseInventoryStatusFilter(rawStatus);
  const session = await requireSession();

  const search = normalizeInventorySearch(q);

  const effectiveRole = session.impersonating?.role ?? session.role;
  // HLD §7.1: a client has no stock or inventory surface. The sidebar hides the
  // link; this is the hard guard for a typed or shared URL, matching /stock
  // (APX-68, found live — the page used to open with an empty table).
  if (effectiveRole === "client") forbidden();
  const isAdmin = effectiveRole === "admin";

  const [{ items, stats }, portfolio] = await Promise.all([
    getBusinessInventory(session, { projectId, search, status }, parsePageRequest(paging)),
    getPortfolio(session),
  ]);

  /** A tile link keeps the project filter and search, and swaps the status. */
  const statusHref = (next: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set("project", projectId);
    if (search) params.set("q", search);
    params.set("status", next);
    return `/inventory?${params.toString()}`;
  };

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
          {
            label: "Low Stock",
            value: <StatusTileLink href={statusHref("low")} count={stats.lowCount} label="low-stock items" />,
            sub: "below minimum stock",
          },
          {
            label: "Critical",
            value: (
              <StatusTileLink
                href={statusHref("critical")}
                count={stats.criticalCount}
                label="out-of-stock items"
              />
            ),
            sub: "out of stock",
          },
        ]}
      />

      <InventoryStatusTabs status={status ?? ""} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <InventoryProjectFilterSelect projects={portfolio.projects} value={projectId ?? ""} />
        <InventorySearchInput value={search ?? ""} />
      </div>

      <Card>
        <InventoryTable
          items={items.rows}
          isAdmin={isAdmin}
          showProject
          role={effectiveRole}
          empty={
            search
              ? `No items match “${search}”.`
              : status
                ? `No ${status === "low" ? "low-stock" : "out-of-stock"} items.`
                : undefined
          }
        />
        <TablePagination page={items.page} pageSize={items.pageSize} total={items.total} />
      </Card>
    </div>
  );
}
