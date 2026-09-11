import { Badge } from "@/components/ui/Badge";
import type { ApprovalStatus, BillStatus, RequestStatus } from "@/lib/types";
import { type InventoryStatus, type PhaseStatus } from "@/lib/logic";
import type { StockRequestStatus } from "@/features/stock/service";
import type { InventoryStatus as StockLevel } from "@/features/inventory/service";

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

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  switch (status) {
    case "Pending":
      return <Badge variant="warning">Pending</Badge>;
    case "Approved":
      return <Badge variant="success">Approved</Badge>;
    case "Rejected":
      return <Badge variant="destructive">Rejected</Badge>;
  }
}

export function BillStatusBadge({ status }: { status: BillStatus }) {
  switch (status) {
    case "Draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "Submitted":
      return <Badge variant="warning">Submitted</Badge>;
    case "Certified":
      return <Badge variant="default">Certified</Badge>;
    case "Paid":
      return <Badge variant="success">Paid</Badge>;
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
