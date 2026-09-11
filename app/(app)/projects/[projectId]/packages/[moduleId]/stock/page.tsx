import { forbidden } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getStockRequestsForProject } from "@/features/stock/queries";
import { ReqTable } from "@/components/domain/ReqTable";
import { Card } from "@/components/ui/Card";

/**
 * build/07-stock-inventory-notifications.md §2.5 step 2: the same table,
 * scoped to one package. `layout.tsx` already hides this tab's link for
 * Client; `forbidden()` here is the hard guard for a direct URL, matching
 * the project-level stock page's own (01-hld.md §7.1: no route at all).
 */
export default async function PackageStockTab({
  params,
}: {
  params: Promise<{ projectId: string; moduleId: string }>;
}) {
  const { projectId, moduleId } = await params;
  const session = await requireSession();

  const effectiveRole = session.impersonating?.role ?? session.role;
  if (effectiveRole === "client") forbidden();
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";

  const requests = await getStockRequestsForProject(session, projectId, { packageId: moduleId });

  return (
    <Card>
      <ReqTable requests={requests} role={effectiveRole} isAdmin={isAdmin} />
    </Card>
  );
}
