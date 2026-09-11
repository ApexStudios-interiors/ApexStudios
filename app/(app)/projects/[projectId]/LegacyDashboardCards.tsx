"use client";

import { useRouter } from "next/navigation";
import type { Role } from "@/lib/rbac/roles";
import { ApprovalTable } from "@/components/domain/ApprovalTable";
import { ReqTable } from "@/components/domain/ReqTable";
import { UpdateList } from "@/components/domain/UpdateList";
import type { UpdateDTO } from "@/features/updates/queries";
import type { StockRequestDTO } from "@/features/stock/queries";
import type { ApprovalDTO } from "@/features/approvals/queries";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/**
 * build/08-approvals.md §2.5 step 7 converts the last card here off
 * `AppContext` (build/04-projects-packages-phases.md §4.4 step 2's own
 * TODO — mislabelled TODO(build-07) by Build 04 and corrected to
 * TODO(build-08) after Build 07, see docs/decisions.md D34).
 *
 * Pending Approvals, Pending Requests and Latest Updates are all real data
 * now — fetched server-side by the page and passed down as props. This
 * component is a client boundary only because `router.push` on "View all"
 * needs one; it has no reason to fetch anything itself.
 */
export function LegacyDashboardCards({
  projectId,
  isClient,
  isSite,
  isAdmin,
  role,
  pendingApprovals,
  pendingRequests,
  updates,
}: {
  projectId: string;
  isClient: boolean;
  isSite: boolean;
  isAdmin: boolean;
  role: Role;
  pendingApprovals: ApprovalDTO[];
  pendingRequests: StockRequestDTO[];
  updates: UpdateDTO[];
}) {
  const router = useRouter();

  return (
    <>
      {pendingApprovals.length > 0 && !isSite && (
        <Card className="mt-5">
          <CardHeader>
            <h3>Pending Approvals</h3>
            <div className="ml-auto flex gap-2 items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push(`/projects/${projectId}/approvals`)}
              >
                View all
              </Button>
            </div>
          </CardHeader>
          <ApprovalTable projectId={projectId} list={pendingApprovals} role={role} />
        </Card>
      )}

      {pendingRequests.length > 0 && !isClient && (
        <Card className="mt-5">
          <CardHeader>
            <h3>Pending Requests</h3>
            <div className="ml-auto flex gap-2 items-center">
              <Button variant="ghost" size="sm" onClick={() => router.push(`/projects/${projectId}/stock`)}>
                View all
              </Button>
            </div>
          </CardHeader>
          <ReqTable requests={pendingRequests} role={role} isAdmin={isAdmin} />
        </Card>
      )}

      {updates.length > 0 && (
        <Card className="mt-5">
          <CardHeader>
            <h3>Latest Updates</h3>
            <div className="ml-auto flex gap-2 items-center">
              <Button variant="ghost" size="sm" onClick={() => router.push(`/projects/${projectId}/updates`)}>
                View all
              </Button>
            </div>
          </CardHeader>
          <UpdateList updates={updates} />
        </Card>
      )}
    </>
  );
}
