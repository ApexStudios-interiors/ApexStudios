import { Badge } from "@/components/ui/Badge";
import { AppData, ApprovalStatus, BillStatus, ModuleT, RequestStatus } from "@/lib/types";
import { PhaseStatus, committed } from "@/lib/logic";

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  switch (status) {
    case "Pending":
      return <Badge variant="outline">● Pending</Badge>;
    case "Approved":
      return <Badge variant="outline">✓ Approved</Badge>;
    case "Ordered":
      return <Badge variant="outline">→ Ordered</Badge>;
    case "Delivered":
      return <Badge variant="default">✓ Delivered</Badge>;
    case "Rejected":
      return <Badge variant="secondary">✕ Rejected</Badge>;
  }
}

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  switch (status) {
    case "Pending":
      return <Badge variant="outline">● Pending</Badge>;
    case "Approved":
      return <Badge variant="default">✓ Approved</Badge>;
    case "Rejected":
      return <Badge variant="secondary">✕ Rejected</Badge>;
  }
}

export function BillStatusBadge({ status }: { status: BillStatus }) {
  switch (status) {
    case "Draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "Submitted":
      return <Badge variant="outline">● Submitted</Badge>;
    case "Certified":
      return <Badge variant="outline">✓ Certified</Badge>;
    case "Paid":
      return <Badge variant="default">✓ Paid</Badge>;
  }
}

export function PhaseStatusBadge({ status }: { status: PhaseStatus }) {
  switch (status) {
    case "Pending":
      return <Badge variant="secondary">In progress</Badge>;
    case "Billable":
      return <Badge variant="outline">● Billable</Badge>;
    case "Billed":
      return <Badge variant="outline">→ Billed</Badge>;
    case "Paid":
      return <Badge variant="default">✓ Paid</Badge>;
  }
}

export function ModuleStatusBadge({ data, projId, m }: { data: AppData; projId: string; m: ModuleT }) {
  const c = committed(data, projId, m);
  if (m.internal && c > m.internal) return <Badge variant="outline">▲ Over budget</Badge>;
  if (m.status === "In progress") return <Badge variant="default">● In progress</Badge>;
  return <Badge variant="secondary">{m.status}</Badge>;
}
