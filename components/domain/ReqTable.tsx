"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import type { Role } from "@/lib/rbac/roles";
import type { StockRequestDTO } from "@/features/stock/queries";
import { availableTransitions } from "@/features/stock/service";
import { transitionStockRequest } from "@/features/stock/actions";
import { dmy } from "@/lib/logic";
import { formatINR } from "@/lib/money";
import { StockRequestStatusBadge } from "@/components/domain/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

/**
 * build/07-stock-inventory-notifications.md §2.5 step 5: props instead of
 * `useApp()`. `isAdmin` gates the Value column (AGENTS.md: `rate` never
 * reaches a non-admin session — the query already omits it, this just
 * decides whether to render the column at all). Per-row actions come from
 * `availableTransitions(status, role)` — one rule, shared by the button set
 * here and by its own unit tests, never re-decided in the UI (build §5:
 * "Do not implement transitions in the UI. The RPC decides; the UI
 * reflects.").
 */
export function ReqTable({
  requests,
  role,
  isAdmin,
}: {
  requests: StockRequestDTO[];
  role: Role;
  isAdmin: boolean;
}) {
  const { openDialog } = useApp();
  const router = useRouter();
  const transition = useAction(transitionStockRequest, { onSuccess: () => router.refresh() });

  if (!requests.length) {
    return (
      <TableWrap>
        <thead>
          <tr>
            <th className={th}>Request</th>
            <th className={th}>Material</th>
            <th className={thNum}>Qty</th>
            {isAdmin && <th className={thNum}>Value</th>}
            <th className={th}>Needed By</th>
            <th className={th}>Status</th>
            <th className={th}></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={td} colSpan={isAdmin ? 7 : 6}>
              <Empty>No requests.</Empty>
            </td>
          </tr>
        </tbody>
      </TableWrap>
    );
  }

  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>Request</th>
          <th className={th}>Material</th>
          <th className={thNum}>Qty</th>
          {isAdmin && <th className={thNum}>Value</th>}
          <th className={th}>Needed By</th>
          <th className={th}>Status</th>
          <th className={th}></th>
        </tr>
      </thead>
      <tbody>
        {requests.map((r) => {
          const transitions = availableTransitions(r.status, role);
          return (
            <tr key={r.id}>
              <td className={td}>
                {r.refNo}
                <span className={sub}>
                  {dmy(r.createdAt.slice(0, 10))} · {r.requestedByName}
                </span>
              </td>
              <td className={td}>
                {r.materialName}
                <span className={sub}>{r.packageName ?? ""}</span>
              </td>
              <td className={tdNum}>
                {r.qty.toLocaleString("en-IN")} {r.unit}
              </td>
              {isAdmin && (
                <td className={tdNum}>
                  {r.value != null ? formatINR(r.value) : <span className="text-muted-foreground">–</span>}
                </td>
              )}
              <td className={td}>{dmy(r.neededBy)}</td>
              <td className={td}>
                <StockRequestStatusBadge status={r.status} />
              </td>
              <td className={td}>
                {transitions.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {transitions.map((t) =>
                      t.to === "rejected" ? (
                        <Button
                          key={t.to}
                          variant="destructive"
                          size="sm"
                          onClick={() => openDialog({ kind: "rejectStockRequest", requestId: r.id })}
                        >
                          {t.label}
                        </Button>
                      ) : (
                        <Button
                          key={t.to}
                          variant={t.to === "approved" ? "primary" : "default"}
                          size="sm"
                          disabled={transition.isPending}
                          onClick={() => transition.execute({ requestId: r.id, toStatus: t.to })}
                        >
                          {t.label}
                        </Button>
                      )
                    )}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}
