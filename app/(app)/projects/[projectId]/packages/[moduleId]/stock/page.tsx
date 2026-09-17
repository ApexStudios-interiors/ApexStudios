import { forbidden } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getStockRequestsPage } from "@/features/stock/queries";
import { ReqTable } from "@/features/stock/components/ReqTable";
import { parsePageRequest } from "@/lib/pagination";
import { Card } from "@/components/ui/Card";
import { TablePagination } from "@/components/shared/TablePagination";

/**
 * build/07-stock-inventory-notifications.md §2.5 step 2: the same table,
 * scoped to one package. `layout.tsx` already hides this tab's link for
 * Client; `forbidden()` here is the hard guard for a direct URL, matching
 * the project-level stock page's own (01-hld.md §7.1: no route at all).
 */
export default async function PackageStockTab({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; moduleId: string }>;
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const { projectId, moduleId } = await params;
  const session = await requireSession();

  const effectiveRole = session.impersonating?.role ?? session.role;
  if (effectiveRole === "client") forbidden();
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";

  const requests = await getStockRequestsPage(
    session,
    projectId,
    { packageId: moduleId },
    parsePageRequest(await searchParams)
  );

  return (
    <Card>
      <ReqTable requests={requests.rows} role={effectiveRole} isAdmin={isAdmin} />
      <TablePagination page={requests.page} pageSize={requests.pageSize} total={requests.total} />
    </Card>
  );
}
