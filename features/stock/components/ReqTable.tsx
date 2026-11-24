"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import type { Role } from "@/lib/rbac/roles";
import type { StockRequestDTO } from "@/features/stock/queries";
import { availableTransitions, isDeadlineAtRisk } from "@/features/stock/service";
import { transitionStockRequest } from "@/features/stock/actions";
import { todayIst } from "@/lib/dates";
import { dmy } from "@/lib/logic";
import { formatINR } from "@/lib/money";
import { StockRequestStatusBadge } from "@/components/shared/StatusBadges";
import { TableWrap } from "@/components/ui/TableWrap";
import { td, tdNum, th, thNum, sub } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
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
 *
 * APX-16: below `md` the rows render as cards (material, qty, needed-by and
 * the actions a supervisor taps), from `md` up as the table. APX-47: an
 * at-risk needed-by date says "At risk" in words, not only in red.
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
  // The one "today" this business keeps (lib/dates) — the same answer on the
  // server and in any browser timezone, so the red date cannot differ between
  // the server render and hydration. Never `new Date()` here.
  const today = todayIst();
  const transition = useAction(transitionStockRequest, { onSuccess: () => router.refresh() });

  const head = (
    <thead>
      <tr>
        <th className={th}>Request</th>
        <th className={th}>Material</th>
        <th className={thNum}>Qty</th>
        {isAdmin && <th className={thNum}>Value</th>}
        <th className={th}>Needed By</th>
        <th className={th}>Status</th>
        <th className={th}>
          <span className="sr-only">Actions</span>
        </th>
      </tr>
    </thead>
  );

  if (!requests.length) {
    return (
      <>
        <div className="md:hidden">
          <Empty>No requests.</Empty>
        </div>
        <div className="max-md:hidden">
          <TableWrap>
            {head}
            <tbody>
              <tr>
                <td className={td} colSpan={isAdmin ? 7 : 6}>
                  <Empty>No requests.</Empty>
                </td>
              </tr>
            </tbody>
          </TableWrap>
        </div>
      </>
    );
  }

  const actionsFor = (r: StockRequestDTO) => {
    const transitions = availableTransitions(r.status, role);
    if (!transitions.length) return null;
    return (
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
    );
  };

  // Red from two business days before the needed-by date, and red from then
  // on once it has passed — while the request is still pending approval.
  // `isDeadlineAtRisk` is the whole rule and is unit-tested; nothing about it
  // is re-decided here. The words "At risk" go with the colour, so the flag
  // does not depend on seeing red.
  const neededBy = (r: StockRequestDTO, atRisk: boolean) =>
    atRisk ? (
      <span className="text-status-destructive font-medium whitespace-nowrap">
        {dmy(r.neededBy)}
        <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wide">At risk</span>
      </span>
    ) : (
      <span className="whitespace-nowrap">{dmy(r.neededBy)}</span>
    );

  return (
    <>
      <ul className="md:hidden divide-y divide-border" aria-label="Stock requests">
        {requests.map((r) => {
          const atRisk = isDeadlineAtRisk(r.status, r.neededBy, today);
          const actions = actionsFor(r);
          return (
            <li key={r.id} className="px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium">{r.materialName}</div>
                  <span className={sub}>
                    {r.qty.toLocaleString("en-IN")} {r.unit}
                    {r.packageName ? ` · ${r.packageName}` : ""}
                  </span>
                </div>
                <StockRequestStatusBadge status={r.status} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Needed by {neededBy(r, atRisk)}</span>
                {isAdmin && r.value != null && <span className="tabular-nums">{formatINR(r.value)}</span>}
                <span className="whitespace-nowrap">{r.refNo}</span>
                <span>
                  <span className="whitespace-nowrap">{dmy(r.createdAt.slice(0, 10))}</span> ·{" "}
                  {r.requestedByName}
                </span>
              </div>
              {actions && <div className="mt-2.5">{actions}</div>}
            </li>
          );
        })}
      </ul>

      <div className="max-md:hidden">
        <TableWrap>
          {head}
          <tbody>
            {requests.map((r) => {
              const atRisk = isDeadlineAtRisk(r.status, r.neededBy, today);
              return (
                <tr key={r.id}>
                  <td className={td}>
                    <span className="whitespace-nowrap">{r.refNo}</span>
                    <span className={sub}>
                      <span className="whitespace-nowrap">{dmy(r.createdAt.slice(0, 10))}</span> ·{" "}
                      {r.requestedByName}
                    </span>
                  </td>
                  <td className={td}>
                    {r.materialName}
                    <span className={sub}>{r.packageName ?? ""}</span>
                  </td>
                  <td className={`${tdNum} whitespace-nowrap`}>
                    {r.qty.toLocaleString("en-IN")} {r.unit}
                  </td>
                  {isAdmin && (
                    <td className={`${tdNum} whitespace-nowrap`}>
                      {r.value != null ? (
                        formatINR(r.value)
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </td>
                  )}
                  <td className={td}>{neededBy(r, atRisk)}</td>
                  <td className={td}>
                    <StockRequestStatusBadge status={r.status} />
                  </td>
                  <td className={td}>{actionsFor(r)}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </div>
    </>
  );
}
