import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getProjectHeader } from "@/features/projects/queries";
import { getApprovalsPage } from "@/features/approvals/queries";
import { parsePageRequest } from "@/lib/pagination";
import { can } from "@/lib/rbac/permissions";
import type { ApprovalStatus } from "@/features/approvals/service";
import { ApprovalTable } from "@/features/approvals/components/ApprovalTable";
import { ApprovalStatusTabs } from "@/features/approvals/components/ApprovalStatusTabs";
import { OpenDialogButton } from "@/components/shared/OpenDialogButton";
import { TablePagination } from "@/components/shared/TablePagination";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

const VALID_STATUSES: ApprovalStatus[] = ["pending", "approved", "rejected"];

/**
 * build/08-approvals.md §2.5 step 1. Same shape as `stock/page.tsx`
 * (Build 07): status tabs are a thin client boundary that navigates on
 * change, the page itself stays a plain Server Component reading
 * `searchParams`. Visible to all three roles (01-hld.md §7.1) — unlike
 * `/stock`, there is no `forbidden()` gate here.
 */
export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ status?: string; page?: string; pageSize?: string }>;
}) {
  const { projectId } = await params;
  const { status: rawStatus, ...paging } = await searchParams;
  const session = await requireSession();
  const effectiveRole = session.impersonating?.role ?? session.role;

  const header = await getProjectHeader(session, projectId);
  if (!header) notFound();

  // "" (All, `ApprovalStatusTabs`'s own explicit value) is a valid,
  // deliberate non-filter. An absent param defaults to "pending" — and so
  // does anything else that isn't recognized (a stale link carrying the old
  // mock's capitalized values, a typo), rather than being silently treated
  // as the same thing as "All": found live in review, an invalid param was
  // indistinguishable from the deliberate All click.
  const status: ApprovalStatus | undefined =
    rawStatus === ""
      ? undefined
      : rawStatus !== undefined && VALID_STATUSES.includes(rawStatus as ApprovalStatus)
        ? (rawStatus as ApprovalStatus)
        : "pending";

  const list = await getApprovalsPage(session, projectId, status ? { status } : {}, parsePageRequest(paging));
  const client = effectiveRole === "client";
  const basePath = `/projects/${projectId}/approvals`;

  return (
    <div>
      <div className="flex items-start gap-4 flex-wrap mb-[22px]">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Approvals</h1>
          <p className="mt-1 text-muted-foreground text-[13.5px]">
            {client
              ? "Samples, makes and drawings waiting for your sign-off."
              : "Client sign-offs on samples, makes and drawings."}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {can(effectiveRole, "requestApproval") && (
            <OpenDialogButton dialog={{ kind: "newApproval", projectId }} variant="primary">
              <Icon name="plus" className="w-[15px] h-[15px]" />
              Request Approval
            </OpenDialogButton>
          )}
        </div>
      </div>

      <ApprovalStatusTabs basePath={basePath} status={status ?? ""} />

      <Card>
        <ApprovalTable projectId={projectId} list={list.rows} role={effectiveRole} />
        <TablePagination page={list.page} pageSize={list.pageSize} total={list.total} />
      </Card>
    </div>
  );
}
