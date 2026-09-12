import { Badge } from "@/components/ui/Badge";
import type { RequestStatus } from "@/lib/types";
import type { BillDTO } from "@/features/billing/queries";
import { type InventoryStatus, type PhaseStatus } from "@/lib/logic";
import type { StockRequestStatus } from "@/features/stock/service";
import type { InventoryStatus as StockLevel } from "@/features/inventory/service";
import { approvalTypeLabel, type ApprovalStatus } from "@/features/approvals/service";
import type { ApprovalType } from "@/features/approvals/schema";

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  switch (status) {
    case "Pending":
      return <Badge variant="warning">Pending</Badge>;
    case "Approved":
      return <Badge variant="default">Approved</Badge>;
    case "Ordered":
      return <Badge variant="outline">Ordered</Badge>;
    case "Delivered":
      return <Badge variant="success">Delivered</Badge>;
    case "Rejected":
      return <Badge variant="destructive">Rejected</Badge>;
  }
}

/**
 * build/08-approvals.md §2.5. Real `approvals.status` (lowercase enum,
 * `features/approvals/service.ts`) — `ApprovalTable.tsx` was this badge's
 * only caller and is fully converted in the same build, so this takes the
 * real shape directly rather than growing a second, `StockRequestStatusBadge`
 * -style name next to a now-dead mock version.
 */
export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  switch (status) {
    case "pending":
      return <Badge variant="warning">Pending</Badge>;
    case "approved":
      return <Badge variant="success">Approved</Badge>;
    case "rejected":
      return <Badge variant="destructive">Rejected</Badge>;
  }
}

export function ApprovalTypeBadge({ type }: { type: ApprovalType }) {
  return <Badge variant="outline">{approvalTypeLabel(type)}</Badge>;
}

/**
 * build/09-billing.md §4.5. Real `bills.status` (lowercase enum) — this
 * badge's every caller is converted in this same build, so it takes the
 * real shape directly rather than growing a second, `StockRequestStatusBadge`
 * -style name next to a now-dead mock version.
 */
export function BillStatusBadge({ status }: { status: BillDTO["status"] }) {
  switch (status) {
    case "draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "submitted":
      return <Badge variant="warning">Submitted</Badge>;
    case "certified":
      return <Badge variant="default">Certified</Badge>;
    case "paid":
      return <Badge variant="success">Paid</Badge>;
    case "cancelled":
      return <Badge variant="destructive">Cancelled</Badge>;
  }
}

export function PhaseStatusBadge({ status }: { status: PhaseStatus }) {
  switch (status) {
    case "Pending":
      return <Badge variant="secondary">In progress</Badge>;
    case "Billable":
      return <Badge variant="warning">Billable</Badge>;
    case "Billed":
      return <Badge variant="default">Billed</Badge>;
    case "Paid":
      return <Badge variant="success">Paid</Badge>;
  }
}

/**
 * `status` is the raw package_status enum value (used for the "in_progress"
 * comparison so this doesn't depend on packageStatusLabel's wording);
 * `statusLabel` is what actually renders. `isOverBudget` only exists on the
 * admin DTO — a client or site row simply doesn't have committed/internal
 * figures to be over, so the prop is optional rather than defaulted to a
 * meaningless `false`.
 */
export function ModuleStatusBadge({
  status,
  statusLabel,
  isOverBudget,
}: {
  status: string;
  statusLabel: string;
  isOverBudget?: boolean;
}) {
  if (isOverBudget) return <Badge variant="destructive">Over budget</Badge>;
  if (status === "in_progress") return <Badge variant="default">{statusLabel}</Badge>;
  return <Badge variant="secondary">{statusLabel}</Badge>;
}

export function InventoryStatusBadge({ status }: { status: InventoryStatus }) {
  switch (status) {
    case "OK":
      return <Badge variant="success">OK</Badge>;
    case "Low":
      return <Badge variant="warning">Low</Badge>;
    case "Critical":
      return <Badge variant="destructive">Critical</Badge>;
  }
}

/**
 * build/07-stock-inventory-notifications.md §2.5. Real `stock_requests.status`
 * (lowercase enum, `features/stock/service.ts`) — same colours as the mock's
 * `RequestStatusBadge` above, which stays for the billing engine's own
 * mock data until Build 09 converts it.
 */
export function StockRequestStatusBadge({ status }: { status: StockRequestStatus }) {
  switch (status) {
    case "pending":
      return <Badge variant="warning">Pending</Badge>;
    case "approved":
      return <Badge variant="default">Approved</Badge>;
    case "ordered":
      return <Badge variant="outline">Ordered</Badge>;
    case "delivered":
      return <Badge variant="success">Delivered</Badge>;
    case "rejected":
      return <Badge variant="destructive">Rejected</Badge>;
  }
}

/** Real `inventoryStatus()` (lowercase, `features/inventory/service.ts`) —
 *  same colours as the mock's `InventoryStatusBadge` above. */
export function StockLevelBadge({ status }: { status: StockLevel }) {
  switch (status) {
    case "ok":
      return <Badge variant="success">OK</Badge>;
    case "low":
      return <Badge variant="warning">Low</Badge>;
    case "critical":
      return <Badge variant="destructive">Critical</Badge>;
  }
}
