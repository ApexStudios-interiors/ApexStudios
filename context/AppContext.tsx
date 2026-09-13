"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { seedData } from "@/lib/data";
import type { AppData, Package, Role, Task } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/rbac/roles";

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
  | null;

interface AppContextValue {
  data: AppData;
  role: Role;
  setRole: (r: Role) => void;
  lastProjectId: string;
  setLastProjectId: (id: string) => void;
  dialog: DialogState;
  openDialog: (d: DialogState) => void;
  closeDialog: () => void;
  toastMsg: string | null;
  toast: (msg: string) => void;

  // mutations
  // setRequestStatus removed: build/07-stock-inventory-notifications.md
  // converts ReqTable to real Server Actions (transitionStockRequest), its
  // only caller.
  // setApprovalStatus removed: build/08-approvals.md converts ApprovalTable's
  // Approve/Reject buttons to real Server Actions (decideApproval), its only
  // caller.
  // setBillStatus/createBill/markPhaseDone removed: build/09-billing.md
  // converts BillingAdmin/BillingClient/MilestoneTable to real Server
  // Actions, their only callers.
  addModule: (
    projectId: string,
    m: { name: string; allocated: number; internal: number; lead: string }
  ) => void;
  editModule: (
    projectId: string,
    moduleId: string,
    m: { name: string; allocated: number; internal: number; lead: string; status: string }
  ) => void;
  // addTask/updateTask removed: build/05-schedule-and-progress.md converts
  // AddTaskDialog and TaskDetailDialog to real Server Actions
  // (features/schedule/actions.ts), the only two callers these ever had.
  // addRequest removed: build/07-stock-inventory-notifications.md converts
  // NewRequestDialog to createStockRequest, its only caller.
  // addApproval/addApprovalPhotos removed: build/08-approvals.md converts
  // NewApprovalDialog and ApprovalPhotosDialog to real Server Actions
  // (requestApproval, addSamplePhotos), their only callers.
  // uploadBillFiles removed: BillUploadDialog converts to the real
  // uploadBillCopy Server Action, its only caller.
  addProject: (p: {
    name: string;
    client: string;
    location: string;
    start: string | null;
    packageNames: string[];
  }) => string;
  inviteUser: (u: { name: string; email: string; role: Role }) => void;
  updateTeamRole: (index: number, role: Role, roleLabel: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function clone<T>(v: T): T {
  return typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

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
  const [data, setData] = useState<AppData>(() => clone(seedData));
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

  // setBillStatus/createBill/markPhaseDone removed: build/09-billing.md
  // converts BillingAdmin/BillingClient/MilestoneTable to real Server
  // Actions (createBill, transitionBill, certifyBill, rejectBill,
  // recordPayment, and rpc_mark_phase_complete's own Server Action wiring),
  // their only callers.
  const addModule = useCallback(
    (projectId: string, m: { name: string; allocated: number; internal: number; lead: string }) => {
      setData((prev) => {
        const next = clone(prev);
        const p = next.projects.find((x) => x.id === projectId);
        if (!p) return prev;
        p.modules.push({
          id: "m" + Date.now(),
          name: m.name || "New Package",
          allocated: m.allocated,
          internal: m.internal,
          lead: m.lead,
          status: "Not started",
          packages: [],
          tasks: [],
        });
        return next;
      });
    },
    []
  );

  const editModule = useCallback(
    (
      projectId: string,
      moduleId: string,
      m: { name: string; allocated: number; internal: number; lead: string; status: string }
    ) => {
      setData((prev) => {
        const next = clone(prev);
        const mod = next.projects.find((x) => x.id === projectId)?.modules.find((x) => x.id === moduleId);
        if (!mod) return prev;
        mod.name = m.name;
        mod.allocated = m.allocated;
        mod.internal = m.internal;
        mod.lead = m.lead;
        mod.status = m.status;
        return next;
      });
    },
    []
  );

  // uploadBillFiles removed: BillUploadDialog converts to the real
  // uploadBillCopy Server Action, its only caller.
  const addProject = useCallback(
    (p: { name: string; client: string; location: string; start: string | null; packageNames: string[] }) => {
      const id = "p" + Date.now();
      setData((prev) => {
        const next = clone(prev);
        const mods = p.packageNames
          .map((s) => s.trim())
          .filter(Boolean)
          .map((n, i) => ({
            id: id + "m" + i,
            name: n,
            allocated: 0,
            internal: 0,
            lead: "To assign",
            status: "Not started",
            packages: [] as Package[],
            tasks: [] as Task[],
          }));
        next.projects.push({
          id,
          name: p.name || "Untitled Project",
          client: p.client,
          location: p.location,
          start: p.start,
          status: "Active",
          modules: mods,
        });
        return next;
      });
      return id;
    },
    []
  );

  const inviteUser = useCallback((u: { name: string; email: string; role: Role }) => {
    setData((prev) => {
      const next = clone(prev);
      next.team.push({ n: u.name || "New user", r: u.role, t: ROLE_LABEL[u.role], e: u.email });
      return next;
    });
  }, []);

  const updateTeamRole = useCallback((index: number, roleValue: Role, roleLabel: string) => {
    setData((prev) => {
      const next = clone(prev);
      const member = next.team[index];
      if (member) {
        member.r = roleValue;
        member.t = roleLabel;
      }
      return next;
    });
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      data,
      role,
      setRole,
      lastProjectId,
      setLastProjectId,
      dialog,
      openDialog,
      closeDialog,
      toastMsg,
      toast,
      addModule,
      editModule,
      addProject,
      inviteUser,
      updateTeamRole,
    }),
    [
      data,
      role,
      lastProjectId,
      dialog,
      toastMsg,
      toast,
      openDialog,
      closeDialog,
      addModule,
      editModule,
      addProject,
      inviteUser,
      updateTeamRole,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
