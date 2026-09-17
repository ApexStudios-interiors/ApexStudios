"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Role } from "@/lib/types";

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
  | { kind: "approvalPhotos"; approvalId: string; projectId: string; item: string }
  | { kind: "decideApproval"; approvalId: string; decision: "approved" | "rejected"; item: string }
  | { kind: "postUpdate"; projectId: string; moduleId?: string }
  | { kind: "editUpdate"; updateId: string; body: string }
  | { kind: "billUpload"; billId: string; projectId: string }
  | { kind: "billView"; billId: string }
  | { kind: "recordPayment"; billId: string; refNo: string; netPayable: number }
  | { kind: "rejectBill"; billId: string; refNo: string }
  | { kind: "certifyBill"; billId: string; refNo: string }
  | { kind: "inviteUser" }
  | { kind: "createClientLogin"; projectId: string; projectName: string }
  | {
      kind: "grantClientAccess";
      projectId: string;
      projectName: string;
      clients: { id: string; fullName: string; email: string | null }[];
    }
  | null;

/**
 * Client-side UI state only. The prototype's `data` (a clone of
 * `lib/data.ts`'s fixture) and the five `setData` mutations left on it —
 * addModule, editModule, addProject, inviteUser, updateTeamRole — are gone
 * with their last reader: every dialog that once called one now calls a real
 * Server Action, and the Sidebar and Header now read the real project list
 * the app shell passes them. What is left is genuinely client-side: the
 * effective role, the open dialog, the toast and the last project visited.
 */
interface AppContextValue {
  role: Role;
  setRole: (r: Role) => void;
  lastProjectId: string;
  setLastProjectId: (id: string) => void;
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
   * `setRole` stays on the context (nothing calls it any more; the Sidebar's
   * old free-form switcher is gone) so no component's imports change until
   * Build 09 deletes the field for good.
   */
  initialRole: Role;
}) {
  const [role, setRole] = useState<Role>(initialRole);
  const [lastProjectId, setLastProjectId] = useState("bhel");
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
      setRole,
      lastProjectId,
      setLastProjectId,
      dialog,
      openDialog,
      closeDialog,
      toastMsg,
      toast,
    }),
    [role, lastProjectId, dialog, toastMsg, toast, openDialog, closeDialog]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
