"use client";

import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { ApprovalTable } from "@/components/domain/ApprovalTable";
import { ReqTable } from "@/components/domain/ReqTable";
import { UpdateList } from "@/components/domain/UpdateList";
import type { UpdateDTO } from "@/features/updates/queries";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/**
 * The two dashboard cards not yet converted off `AppContext`
 * (build/04-projects-packages-phases.md §4.4 step 2):
 *   TODO(build-07): Pending Approvals — features/approvals/ lands there.
 *   TODO(build-08): Pending Requests — features/stock/ lands there.
 * Latest Updates is real data now (build/06-files-jobs-daily-updates.md
 * §4.2) — fetched server-side by the page and passed down as `updates`,
 * since this component is a client boundary for the other two cards but has
 * no reason to fetch updates itself.
 *
 * Does NOT use `useProject()` — that hook throws for a project id absent
 * from the mock array, and a project created through the real `createProject`
 * action has no entry there and never will. Found live: creating a project
 * and landing on its own dashboard crashed to the generic error boundary.
 * The two still-mock cards simply have nothing to show for such a project,
 * the same honest answer `useLegacyModule` already gives the package tabs
 * still on AppContext.
 */
export function LegacyDashboardCards({
  projectId,
  isClient,
  isSite,
  updates,
}: {
  projectId: string;
  isClient: boolean;
  isSite: boolean;
  updates: UpdateDTO[];
}) {
  const router = useRouter();
  const { data } = useApp();
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) return null;

  const pending = data.requests.filter((r) => r.proj === project.id && r.status === "Pending");
  const apPending = data.approvals.filter((a) => a.proj === project.id && a.status === "Pending");

  return (
    <>
      {apPending.length > 0 && !isSite && (
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

      {pending.length > 0 && !isClient && (
        <Card className="mt-5">
          <CardHeader>
            <h3>Pending Requests</h3>
            <div className="ml-auto flex gap-2 items-center">
              <Button variant="ghost" size="sm" onClick={() => router.push(`/projects/${projectId}/stock`)}>
                View all
              </Button>
            </div>
          </CardHeader>
          <ReqTable project={project} reqs={pending} />
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
