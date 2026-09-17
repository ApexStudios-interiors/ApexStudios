import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { forbidden } from "next/navigation";
import { getProjectHeader } from "@/features/projects/queries";
import { countStockRequests, getStockRequestsPage } from "@/features/stock/queries";
import { parsePageRequest } from "@/lib/pagination";
import { getPackageOptions } from "@/features/stock/actions";
import type { StockRequestStatus } from "@/features/stock/service";
import { ReqTable } from "@/features/stock/components/ReqTable";
import { StockStatusTabs } from "@/features/stock/components/StockStatusTabs";
import { PackageFilterSelect } from "@/features/packages/components/PackageFilterSelect";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { TablePagination } from "@/components/shared/TablePagination";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

const VALID_STATUSES: StockRequestStatus[] = ["pending", "approved", "ordered", "delivered", "rejected"];

/**
 * build/07-stock-inventory-notifications.md §2.5 step 1. Status tabs and the
 * package filter are both thin client boundaries that navigate on change
 * (`StockStatusTabs`/`PackageFilterSelect`, Build 06's own pattern); the page
 * itself stays a plain Server Component reading `searchParams`. 01-hld.md
 * §7.1: Client has no route here at all — `forbidden()` (build/03's
 * `authInterrupts`), not an empty state.
 *
 * The status and package filters and `page`/`pageSize` are all applied in
 * the query (lib/pagination.ts); "N pending" is its own count, so it does
 * not change with the page or the status tab.
 */
export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ status?: string; package?: string; page?: string; pageSize?: string }>;
}) {
  const { projectId } = await params;
  const { status: rawStatus, package: packageId, ...paging } = await searchParams;
  const session = await requireSession();

  const effectiveRole = session.impersonating?.role ?? session.role;
  if (effectiveRole === "client") forbidden();

  const header = await getProjectHeader(session, projectId);
  if (!header) notFound();

  const status = VALID_STATUSES.includes(rawStatus as StockRequestStatus)
    ? (rawStatus as StockRequestStatus)
    : undefined;

  const [requests, pendingCount, packages] = await Promise.all([
    getStockRequestsPage(session, projectId, { status, packageId }, parsePageRequest(paging)),
    countStockRequests(session, projectId, { status: "pending", packageId }),
    getPackageOptions(projectId),
  ]);

  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";
  const basePath = `/projects/${projectId}/stock`;

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Stock Requests</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">{pendingCount} pending</p>
        </div>
        <div className="ml-auto flex gap-2">
          <OpenDialogButton dialog={{ kind: "newRequest", projectId }} variant="primary">
            <Icon name="plus" className="w-[15px] h-[15px]" />
            New Request
          </OpenDialogButton>
        </div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <StockStatusTabs basePath={basePath} status={status ?? ""} packageId={packageId} />
        <PackageFilterSelect basePath={basePath} packages={packages} value={packageId ?? ""} />
      </div>

      <Card>
        <ReqTable requests={requests.rows} role={effectiveRole} isAdmin={isAdmin} />
        <TablePagination page={requests.page} pageSize={requests.pageSize} total={requests.total} />
      </Card>
    </div>
  );
}
