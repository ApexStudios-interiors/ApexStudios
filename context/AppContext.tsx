"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { seedData } from "@/lib/data";
import type {
  AppData,
  ApprovalStatus,
  BillFile,
  BillStatus,
  Package,
  RequestStatus,
  Role,
  Task,
} from "@/lib/types";
import { billableItems, lineVal } from "@/lib/logic";
import { ROLE_LABEL } from "@/lib/rbac/roles";

const TODAY_ISO = "2026-09-07";

export type DialogState =
  | { kind: "addProject" }
  | { kind: "addModule"; projectId: string }
  | { kind: "editModule"; projectId: string; moduleId: string }
  | { kind: "addTask"; projectId: string; moduleId: string }
  | { kind: "taskDetail"; projectId: string; moduleId: string; taskIndex: number }
  | { kind: "newRequest"; projectId: string; moduleId?: string }
  | { kind: "newApproval"; projectId: string; moduleId?: string }
  | { kind: "approvalPhotos"; approvalId: string }
  | { kind: "postUpdate"; projectId: string; moduleId?: string }
  | { kind: "billUpload"; billId: string }
  | { kind: "billView"; billId: string }
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
  setRequestStatus: (id: string, status: RequestStatus) => void;
  setApprovalStatus: (id: string, status: ApprovalStatus) => void;
  setBillStatus: (id: string, status: BillStatus) => void;
  createBill: (projectId: string, selectedKeys: Set<string>) => string | null;
  markPhaseDone: (projectId: string, moduleId: string, pkgId: string) => void;
  addModule: (
    projectId: string,
    m: { name: string; allocated: number; internal: number; lead: string }
  ) => void;
  editModule: (
    projectId: string,
    moduleId: string,
    m: { name: string; allocated: number; internal: number; lead: string; status: string }
  ) => void;
  addTask: (
    projectId: string,
    moduleId: string,
    t: { t: string; pkg: string; owner: string; w: number; d: number }
  ) => void;
  updateTask: (projectId: string, moduleId: string, taskIndex: number, patch: Partial<Task>) => void;
  addRequest: (
    projectId: string,
    r: { mod: string; pkg?: string; item: string; qty: number; unit: string; rate: number; need: string }
  ) => void;
  addApproval: (
    projectId: string,
    a: { mod: string; pkg?: string; type: string; item: string; need: string; note: string; photos: number }
  ) => void;
  addApprovalPhotos: (approvalId: string, count: number) => void;
  addUpdate: (projectId: string, u: { mod: string; date: string; text: string; photos: number }) => void;
  uploadBillFiles: (billId: string, files: BillFile[]) => void;
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

  const setRequestStatus = useCallback((id: string, status: RequestStatus) => {
    setData((prev) => {
      const next = clone(prev);
      const r = next.requests.find((x) => x.id === id);
      if (r) r.status = status;
      return next;
    });
  }, []);

  const setApprovalStatus = useCallback((id: string, status: ApprovalStatus) => {
    setData((prev) => {
      const next = clone(prev);
      const a = next.approvals.find((x) => x.id === id);
      if (a) {
        a.status = status;
        a.decided = TODAY_ISO;
      }
      return next;
    });
  }, []);

  const setBillStatus = useCallback((id: string, status: BillStatus) => {
    setData((prev) => {
      const next = clone(prev);
      const b = next.bills.find((x) => x.id === id);
      if (b) {
        b.status = status;
        if (status === "Submitted") b.submitted = TODAY_ISO;
        if (status === "Certified") b.certified = TODAY_ISO;
        if (status === "Paid") b.paid = TODAY_ISO;
      }
      return next;
    });
  }, []);

  const createBill = useCallback((projectId: string, selectedKeys: Set<string>): string | null => {
    let newId: string | null = null;
    setData((prev) => {
      const next = clone(prev);
      const p = next.projects.find((x) => x.id === projectId);
      if (!p) return prev;
      const items = billableItems(prev, p).filter((i) => selectedKeys.has(i.key));
      if (!items.length) return prev;
      const id = "RA-" + String(next.bills.length + 1).padStart(3, "0");
      let recovery = 0;
      const phs = new Set(items.filter((i) => i.type === "milestone").map((i) => i.mod + ":" + i.pkg));
      next.bills
        .filter((b) => b.proj === p.id)
        .forEach((b) =>
          b.lines.forEach((l) => {
            if (l.type === "material" && phs.has(l.mod + ":" + l.pkg) && !l.recovered) {
              recovery += lineVal(l);
              l.recovered = true;
            }
          })
        );
      const lines = items.map((i) => ({
        type: i.type,
        mod: i.mod,
        pkg: i.pkg,
        desc: i.desc,
        cost: i.cost,
        client: i.client,
        pct: i.pct,
      }));
      next.bills.push({ id, proj: p.id, date: TODAY_ISO, status: "Draft", lines, recovery, files: [] });
      items.forEach((i) => {
        if (i.type === "material") {
          const key = i.key.slice(2);
          const r = next.requests.find((x) => x.id === key);
          if (r) r.billedIn = id;
        } else {
          const m = p.modules.find((x) => x.id === i.mod);
          const k = m?.packages.find((x) => x.id === i.pkg);
          if (k) k.billedIn = id;
        }
      });
      newId = id;
      return next;
    });
    return newId;
  }, []);

  const markPhaseDone = useCallback((projectId: string, moduleId: string, pkgId: string) => {
    setData((prev) => {
      const next = clone(prev);
      const m = next.projects.find((x) => x.id === projectId)?.modules.find((x) => x.id === moduleId);
      const k = m?.packages.find((x) => x.id === pkgId);
      if (k) k.done = true;
      return next;
    });
  }, []);

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

  const addTask = useCallback(
    (
      projectId: string,
      moduleId: string,
      t: { t: string; pkg: string; owner: string; w: number; d: number }
    ) => {
      setData((prev) => {
        const next = clone(prev);
        const mod = next.projects.find((x) => x.id === projectId)?.modules.find((x) => x.id === moduleId);
        if (!mod) return prev;
        mod.tasks.push({
          t: t.t || "New task",
          owner: t.owner || "To assign",
          w: t.w || 1,
          d: t.d || 1,
          p: 0,
          pkg: t.pkg,
        });
        return next;
      });
    },
    []
  );

  const updateTask = useCallback(
    (projectId: string, moduleId: string, taskIndex: number, patch: Partial<Task>) => {
      setData((prev) => {
        const next = clone(prev);
        const mod = next.projects.find((x) => x.id === projectId)?.modules.find((x) => x.id === moduleId);
        const task = mod?.tasks[taskIndex];
        if (!task) return prev;
        Object.assign(task, patch);
        return next;
      });
    },
    []
  );

  const addRequest = useCallback(
    (
      projectId: string,
      r: { mod: string; pkg?: string; item: string; qty: number; unit: string; rate: number; need: string }
    ) => {
      setData((prev) => {
        const next = clone(prev);
        const by = next.team.find((t) => t.r === role)?.n.split(" ")[0] || "You";
        const n = next.requests.length + 15;
        next.requests.unshift({
          id: "SR-0" + n,
          proj: projectId,
          mod: r.mod,
          pkg: r.pkg,
          item: r.item || "Item",
          qty: r.qty || 0,
          unit: r.unit,
          rate: r.rate || 0,
          by,
          need: r.need,
          status: "Pending",
          raised: TODAY_ISO,
        });
        return next;
      });
    },
    [role]
  );

  const addApproval = useCallback(
    (
      projectId: string,
      a: { mod: string; pkg?: string; type: string; item: string; need: string; note: string; photos: number }
    ) => {
      setData((prev) => {
        const next = clone(prev);
        const by = next.team.find((t) => t.r === role)?.n.split(" ")[0] || "You";
        next.approvals.unshift({
          id: "AP-" + String(next.approvals.length + 1).padStart(3, "0"),
          proj: projectId,
          mod: a.mod,
          pkg: a.pkg,
          type: a.type,
          item: a.item || "Item",
          by,
          requested: TODAY_ISO,
          need: a.need,
          status: "Pending",
          note: a.note,
          photos: a.photos,
        });
        return next;
      });
    },
    [role]
  );

  const addApprovalPhotos = useCallback((approvalId: string, count: number) => {
    setData((prev) => {
      const next = clone(prev);
      const a = next.approvals.find((x) => x.id === approvalId);
      if (a) a.photos = (a.photos || 0) + count;
      return next;
    });
  }, []);

  const addUpdate = useCallback(
    (projectId: string, u: { mod: string; date: string; text: string; photos: number }) => {
      setData((prev) => {
        const next = clone(prev);
        const by = next.team.find((t) => t.r === role)?.n.split(" ")[0] || "You";
        next.updates.unshift({
          id: "u" + Date.now(),
          proj: projectId,
          mod: u.mod,
          date: u.date,
          by,
          text: u.text || "Update",
          men: 0,
          photos: u.photos,
        });
        return next;
      });
    },
    [role]
  );

  const uploadBillFiles = useCallback((billId: string, files: BillFile[]) => {
    setData((prev) => {
      const next = clone(prev);
      const b = next.bills.find((x) => x.id === billId);
      if (b)
        b.files = (b.files || []).concat(
          files.length ? files : [{ n: b.id + " Apex Studios Bill.pdf", s: "310 KB" }]
        );
      return next;
    });
  }, []);

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
      setRequestStatus,
      setApprovalStatus,
      setBillStatus,
      createBill,
      markPhaseDone,
      addModule,
      editModule,
      addTask,
      updateTask,
      addRequest,
      addApproval,
      addApprovalPhotos,
      addUpdate,
      uploadBillFiles,
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
      setRequestStatus,
      setApprovalStatus,
      setBillStatus,
      createBill,
      markPhaseDone,
      addModule,
      editModule,
      addTask,
      updateTask,
      addRequest,
      addApproval,
      addApprovalPhotos,
      addUpdate,
      uploadBillFiles,
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
