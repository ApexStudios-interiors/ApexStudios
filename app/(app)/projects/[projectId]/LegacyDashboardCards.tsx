"use client";

import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import type { Role } from "@/lib/rbac/roles";
import { ApprovalTable } from "@/components/domain/ApprovalTable";
import { ReqTable } from "@/components/domain/ReqTable";
import { UpdateList } from "@/components/domain/UpdateList";
import type { UpdateDTO } from "@/features/updates/queries";
import type { StockRequestDTO } from "@/features/stock/queries";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/**
 * The one dashboard card not yet converted off `AppContext`
 * (build/04-projects-packages-phases.md §4.4 step 2):
 *   TODO(build-08): Pending Approvals — features/approvals/ lands there.
 * (Corrected label — this was mislabelled TODO(build-07) by Build 04; Build 07
 * is entirely stock/inventory/notifications/search and never touches
 * approvals. See docs/decisions.md D34.)
 *
 * Pending Requests and Latest Updates are both real data now
 * (build/07-stock-inventory-notifications.md §2.5 step 6 and
 * build/06-files-jobs-daily-updates.md §4.2 respectively) — fetched
 * server-side by the page and passed down as props, since this component is
 * a client boundary for the one still-mock card but has no reason to fetch
 * either of the real ones itself.
 *
 * Does NOT use `useProject()` for the mock Approvals card — that hook throws
 * for a project id absent from the mock array, and a project created through
 * the real `createProject` action has no entry there and never will. Found
 * live: creating a project and landing on its own dashboard crashed to the
 * generic error boundary. The still-mock card simply has nothing to show for
 * such a project, the same honest answer `useLegacyModule` already gives the
 * package tabs still on AppContext.
 */
export function LegacyDashboardCards({
  projectId,
  isClient,
  isSite,
  isAdmin,
  role,
  pendingRequests,
  updates,
}: {
  projectId: string;
  isClient: boolean;
  isSite: boolean;
  isAdmin: boolean;
  role: Role;
  pendingRequests: StockRequestDTO[];
  updates: UpdateDTO[];
}) {
  const router = useRouter();
  const { data } = useApp();
  const project = data.projects.find((p) => p.id === projectId);

  const apPending = project
    ? data.approvals.filter((a) => a.proj === project.id && a.status === "Pending")
    : [];

  return (
    <>
      {project && apPending.length > 0 && !isSite && (
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
          <ApprovalTable project={project} list={apPending} />
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
