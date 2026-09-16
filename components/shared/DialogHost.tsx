"use client";

import { useApp } from "@/context/AppContext";
import { AddProjectDialog } from "@/features/projects/components/AddProjectDialog";
import { AddModuleDialog } from "@/features/packages/components/AddModuleDialog";
import { EditModuleDialog } from "@/features/packages/components/EditModuleDialog";
import { AddTaskDialog } from "@/features/schedule/components/AddTaskDialog";
import { TaskDetailDialog } from "@/features/schedule/components/TaskDetailDialog";
import { NewRequestDialog } from "./NewRequestDialog";
import { RejectStockRequestDialog } from "@/features/stock/components/RejectStockRequestDialog";
import { NewApprovalDialog } from "@/features/approvals/components/NewApprovalDialog";
import { ApprovalPhotosDialog } from "@/features/approvals/components/ApprovalPhotosDialog";
import { DecideApprovalDialog } from "@/features/approvals/components/DecideApprovalDialog";
import { PostUpdateDialog } from "@/features/updates/components/PostUpdateDialog";
import { EditUpdateDialog } from "@/features/updates/components/EditUpdateDialog";
import { BillUploadDialog } from "@/features/billing/components/BillUploadDialog";
import { BillViewDialog } from "@/features/billing/components/BillViewDialog";
import { RecordPaymentDialog } from "@/features/billing/components/RecordPaymentDialog";
import { RejectBillDialog } from "@/features/billing/components/RejectBillDialog";
import { CertifyBillDialog } from "@/features/billing/components/CertifyBillDialog";
import { InviteUserDialog } from "@/features/auth/components/InviteUserDialog";

export function DialogHost() {
  const { dialog } = useApp();
  if (!dialog) return null;

  switch (dialog.kind) {
    case "addProject":
      return <AddProjectDialog />;
    case "addModule":
      return <AddModuleDialog projectId={dialog.projectId} />;
    case "editModule":
      return <EditModuleDialog projectId={dialog.projectId} moduleId={dialog.moduleId} />;
    case "addTask":
      return <AddTaskDialog projectId={dialog.projectId} moduleId={dialog.moduleId} />;
    case "taskDetail":
      return (
        <TaskDetailDialog projectId={dialog.projectId} moduleId={dialog.moduleId} taskId={dialog.taskId} />
      );
    case "newRequest":
      return <NewRequestDialog projectId={dialog.projectId} moduleId={dialog.moduleId} />;
    case "rejectStockRequest":
      return <RejectStockRequestDialog requestId={dialog.requestId} />;
    case "newApproval":
      return (
        <NewApprovalDialog
          projectId={dialog.projectId}
          moduleId={dialog.moduleId}
          supersedes={dialog.supersedes}
        />
      );
    case "approvalPhotos":
      return (
        <ApprovalPhotosDialog
          approvalId={dialog.approvalId}
          projectId={dialog.projectId}
          item={dialog.item}
        />
      );
    case "decideApproval":
      return (
        <DecideApprovalDialog approvalId={dialog.approvalId} decision={dialog.decision} item={dialog.item} />
      );
    case "postUpdate":
      return <PostUpdateDialog projectId={dialog.projectId} moduleId={dialog.moduleId} />;
    case "editUpdate":
      return <EditUpdateDialog updateId={dialog.updateId} body={dialog.body} />;
    case "billUpload":
      return <BillUploadDialog billId={dialog.billId} projectId={dialog.projectId} />;
    case "billView":
      return <BillViewDialog billId={dialog.billId} />;
    case "recordPayment":
      return (
        <RecordPaymentDialog billId={dialog.billId} refNo={dialog.refNo} netPayable={dialog.netPayable} />
      );
    case "rejectBill":
      return <RejectBillDialog billId={dialog.billId} refNo={dialog.refNo} />;
    case "certifyBill":
      return <CertifyBillDialog billId={dialog.billId} refNo={dialog.refNo} />;
    case "inviteUser":
      return <InviteUserDialog />;
    default:
      return null;
  }
}
