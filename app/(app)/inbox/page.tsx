import { requireSession } from "@/lib/auth/session";
import { getActionItems } from "@/features/notifications/queries";
import { ActionItemsTable } from "@/features/notifications/components/ActionItemsTable";
import { parsePageRequest } from "@/lib/pagination";
import { TablePagination } from "@/components/shared/TablePagination";
import { Card } from "@/components/ui/Card";

/** What each role's list holds, said once under the heading. */
const INTRO: Record<"admin" | "site" | "client", string> = {
  admin:
    "Stock requests to decide, draft bills to submit, certified bills awaiting payment and rejected approvals to revise — across every project, oldest first.",
  site: "Ordered materials waiting to be received, and your stock requests that were rejected — across your projects, oldest first.",
  client: "Approvals and bills waiting for your decision — across your projects, oldest first.",
};

/**
 * "Needs my action" (APX-72, D72): one aged list of everything waiting on the
 * signed-in user, linked from the bell and the sidebar. Every role may open
 * it; what it lists is the role's own (features/notifications/service.ts
 * ACTION_KINDS) through the same RLS-scoped `v_notifications` the bell reads.
 * While previewing, it is the previewed role on the previewed project.
 *
 * Loading is `loading.tsx`; a failed read is this segment's `error.tsx`.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const session = await requireSession();
  const role = session.impersonating?.role ?? session.role;
  const items = await getActionItems(session, parsePageRequest(await searchParams));

  return (
    <div>
      <div className="mb-[22px]">
        <h1 className="text-[26px] font-bold tracking-tight">Needs my action</h1>
        <p className="mt-1 text-muted-foreground text-[13.5px] max-w-[720px]">{INTRO[role]}</p>
      </div>
      <Card>
        <ActionItemsTable items={items.rows} />
        <TablePagination page={items.page} pageSize={items.pageSize} total={items.total} />
      </Card>
    </div>
  );
}
