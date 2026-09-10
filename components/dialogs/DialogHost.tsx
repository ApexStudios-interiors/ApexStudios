"use client";

import { useApp } from "@/context/AppContext";
import { AddProjectDialog } from "./AddProjectDialog";
import { AddModuleDialog } from "./AddModuleDialog";
import { EditModuleDialog } from "./EditModuleDialog";
import { AddTaskDialog } from "./AddTaskDialog";
import { TaskDetailDialog } from "./TaskDetailDialog";
import { NewRequestDialog } from "./NewRequestDialog";
import { NewApprovalDialog } from "./NewApprovalDialog";
import { ApprovalPhotosDialog } from "./ApprovalPhotosDialog";
import { PostUpdateDialog } from "./PostUpdateDialog";
import { EditUpdateDialog } from "./EditUpdateDialog";
import { BillUploadDialog } from "./BillUploadDialog";
import { BillViewDialog } from "./BillViewDialog";
import { InviteUserDialog } from "./InviteUserDialog";

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
    case "newApproval":
      return <NewApprovalDialog projectId={dialog.projectId} moduleId={dialog.moduleId} />;
    case "approvalPhotos":
      return <ApprovalPhotosDialog approvalId={dialog.approvalId} />;
    case "postUpdate":
      return <PostUpdateDialog projectId={dialog.projectId} moduleId={dialog.moduleId} />;
    case "editUpdate":
      return <EditUpdateDialog updateId={dialog.updateId} body={dialog.body} />;
    case "billUpload":
      return <BillUploadDialog billId={dialog.billId} />;
    case "billView":
      return <BillViewDialog billId={dialog.billId} />;
    case "inviteUser":
      return <InviteUserDialog />;
    default:
      return null;
  }
}
