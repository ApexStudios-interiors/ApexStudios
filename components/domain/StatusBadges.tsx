import { Badge } from "@/components/ui/Badge";
import type { AppData, ApprovalStatus, BillStatus, ModuleT, RequestStatus } from "@/lib/types";
import { type InventoryStatus, type PhaseStatus, committed } from "@/lib/logic";

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

export function ModuleStatusBadge({ data, projId, m }: { data: AppData; projId: string; m: ModuleT }) {
  const c = committed(data, projId, m);
  if (m.internal && c > m.internal) return <Badge variant="destructive">Over budget</Badge>;
  if (m.status === "In progress") return <Badge variant="default">In progress</Badge>;
  return <Badge variant="secondary">{m.status}</Badge>;
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
