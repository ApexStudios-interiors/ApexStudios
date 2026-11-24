"use client";

import type { Role } from "@/lib/rbac/roles";
import type { StockRequestDTO } from "@/features/stock/queries";
import { isDeadlineAtRisk } from "@/features/stock/service";
import { todayIst } from "@/lib/dates";
import { dmy } from "@/lib/logic";
import { formatINR } from "@/lib/money";
import { StockRequestStatusBadge } from "@/components/shared/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { StockRequestActions } from "./StockRequestActions";
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
  // The one "today" this business keeps (lib/dates) — the same answer on the
  // server and in any browser timezone, so the red date cannot differ between
  // the server render and hydration. Never `new Date()` here.
  const today = todayIst();

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
          // Red from two business days before the needed-by date, and red
          // from then on once it has passed — while the request is still
          // pending approval. `isDeadlineAtRisk` is the whole rule and is
          // unit-tested; nothing about it is re-decided here.
          const atRisk = isDeadlineAtRisk(r.status, r.neededBy, today);
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
              <td className={atRisk ? `${td} text-status-destructive font-medium` : td}>{dmy(r.neededBy)}</td>
              <td className={td}>
                <StockRequestStatusBadge status={r.status} />
                {/* APX-39: why it stopped — the reason was stored but never shown. */}
                {r.status === "rejected" && r.rejectedReason && (
                  <span className={`${sub} max-w-[220px] truncate`} title={r.rejectedReason}>
                    {r.rejectedReason}
                  </span>
                )}
                {r.status === "cancelled" && (
                  <span className={`${sub} max-w-[220px] truncate`} title={r.cancelledReason ?? undefined}>
                    {r.cancelledReason ?? "Withdrawn by the requester"}
                  </span>
                )}
                {r.splitFromId && r.status !== "cancelled" && (
                  <span className={sub}>Remainder of a part delivery</span>
                )}
              </td>
              <td className={td}>
                <StockRequestActions request={r} role={role} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}
