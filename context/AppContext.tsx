"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Role } from "@/lib/rbac/roles";

export type DialogState =
  | { kind: "addProject" }
  | { kind: "addModule"; projectId: string }
  | { kind: "editModule"; projectId: string; moduleId: string }
  | { kind: "addTask"; projectId: string; moduleId: string }
  | { kind: "taskDetail"; projectId: string; moduleId: string; taskId: string }
  | { kind: "newRequest"; projectId: string; moduleId?: string }
  | { kind: "rejectStockRequest"; requestId: string }
  | {
      kind: "newApproval";
      projectId: string;
      moduleId?: string;
      // build §2.3: "Raise revised approval" on a rejected row pre-fills a
      // new request from it, with `supersedesId` set — not present on a
      // plain "+ Request Approval" open.
      supersedes?: {
        id: string;
        packageId: string;
        phaseId: string | null;
        type: string;
        item: string;
      };
    }
  | {
      kind: "approvalPhotos";
      approvalId: string;
      projectId: string;
      item: string;
      /** Photos already on the approval, so the uploader offers only what is
       *  left of MAX_PHOTOS_PER_ENTITY (APX-46). Optional: 0 when omitted. */
      existingPhotos?: number;
    }
  | { kind: "decideApproval"; approvalId: string; decision: "approved" | "rejected"; item: string }
  | { kind: "postUpdate"; projectId: string; moduleId?: string }
  | { kind: "editUpdate"; updateId: string; body: string }
  | { kind: "billUpload"; billId: string; projectId: string }
  | { kind: "billView"; billId: string }
  | { kind: "recordPayment"; billId: string; refNo: string; netPayable: number }
  | { kind: "rejectBill"; billId: string; refNo: string }
  | { kind: "certifyBill"; billId: string; refNo: string }
  | { kind: "inviteUser"; projects: { id: string; name: string }[] }
  | {
      kind: "grantClientAccess";
      projectId: string;
      projectName: string;
      clients: { id: string; fullName: string; email: string | null }[];
    }
  // APX-10/11/12: project setup screens.
  | { kind: "editProject"; projectId: string }
  | { kind: "projectStatus"; projectId: string; projectName: string; status: string }
  | { kind: "addPhase"; projectId: string; moduleId: string; thenAddTask?: boolean }
  | { kind: "editPhase"; projectId: string; moduleId: string; phaseId: string }
  | {
      kind: "grantSiteAccess";
      projectId: string;
      projectName: string;
      supervisors: { id: string; fullName: string; email: string | null }[];
    }
  | { kind: "adjustInventory"; item: { id: string; name: string; unit: string; qtyOnHand: number } }
  | null;

/**
 * Client-side UI state only. The prototype's `data` fixture and its `setData`
 * mutations went first; `setRole` (no caller since the Sidebar's free-form
 * role switcher was removed) and `lastProjectId` (written by ProjectShell,
 * never read) followed in APX-67. What is left is genuinely client-side: the
 * effective role, the open dialog and the toast.
 */
interface AppContextValue {
  role: Role;
  dialog: DialogState;
  openDialog: (d: DialogState) => void;
  closeDialog: () => void;
  toastMsg: string | null;
  toast: (msg: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  children,
  initialRole,
}: {
  children: React.ReactNode;
  /**
   * The EFFECTIVE role: the real session's role, or the previewed role while
   * an owner/admin has impersonation active (D20). Locked in from the real
   * session at app/(app)/layout.tsx — build/03-auth-and-rbac.md §2.8 step 2.
   * Read straight from the prop rather than copied into state, so a server
   * re-render (starting or ending a preview) cannot leave a stale role here.
   */
  initialRole: Role;
}) {
  const role = initialRole;
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2400);
  }, []);

  const openDialog = useCallback((d: DialogState) => setDialog(d), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  const value = useMemo<AppContextValue>(
    () => ({
      role,
      dialog,
      openDialog,
      closeDialog,
      toastMsg,
      toast,
    }),
    [role, dialog, toastMsg, toast, openDialog, closeDialog]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
