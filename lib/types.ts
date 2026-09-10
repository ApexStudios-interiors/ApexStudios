// D8: owner sits above admin. Every place that branches on role and does not
// re-export from lib/rbac/roles.ts must treat owner as a superset of admin —
// lib/logic.ts's isMoney/canApprove and every exact `role === "admin"` check
// elsewhere were audited and paired with owner when this was widened
// (build/03-auth-and-rbac.md). A NEW exact-match "admin" check added later
// needs the same pairing; this is exactly what @typescript-eslint's exhaustive
// switch checks and this file's own re-export from lib/rbac/roles catch.
import type { Role } from "@/lib/rbac/roles";
export type { Role };

export interface Package {
  id: string;
  name: string;
  alloc: number;
  int: number;
  billedIn?: string;
  done?: boolean;
}

export interface Task {
  t: string;
  owner: string;
  w: number;
  d: number;
  p: number;
  pkg?: string;
}

export interface ModuleT {
  id: string;
  name: string;
  allocated: number;
  internal: number;
  lead: string;
  status: string;
  packages: Package[];
  tasks: Task[];
}

export interface Project {
  id: string;
  name: string;
  client: string;
  location: string;
  start: string | null;
  status: string;
  modules: ModuleT[];
}

export type RequestStatus = "Pending" | "Approved" | "Ordered" | "Delivered" | "Rejected";

export interface StockRequest {
  id: string;
  proj: string;
  mod: string;
  pkg?: string;
  item: string;
  qty: number;
  unit: string;
  rate: number;
  by: string;
  need: string;
  status: RequestStatus;
  raised: string;
  billedIn?: string;
}

export type BillLineType = "material" | "milestone";

export interface BillLine {
  type: BillLineType;
  mod: string;
  pkg: string;
  desc: string;
  cost: number;
  client: number;
  pct: number;
  recovered?: boolean;
}

export type BillStatus = "Draft" | "Submitted" | "Certified" | "Paid";

export interface BillFile {
  n: string;
  s: string;
}

export interface Bill {
  id: string;
  proj: string;
  date: string;
  status: BillStatus;
  submitted?: string;
  certified?: string;
  paid?: string;
  lines: BillLine[];
  recovery: number;
  files: BillFile[];
}

export interface Update {
  id: string;
  proj: string;
  mod: string;
  date: string;
  by: string;
  text: string;
  men: number;
  photos: number;
}

export type ApprovalStatus = "Pending" | "Approved" | "Rejected";

export interface Approval {
  id: string;
  proj: string;
  mod: string;
  pkg?: string;
  type: string;
  item: string;
  by: string;
  requested: string;
  need: string;
  status: ApprovalStatus;
  decided?: string;
  note?: string;
  photos: number;
}

export interface TeamMember {
  n: string;
  r: Role;
  t: string;
  e: string;
}

export interface InventoryItem {
  id: string;
  proj: string;
  name: string;
  category: string;
  qty: number;
  unit: string;
  reorderLevel: number;
  unitCost: number;
  location: string;
}

export interface AppData {
  projects: Project[];
  requests: StockRequest[];
  bills: Bill[];
  updates: Update[];
  approvals: Approval[];
  team: TeamMember[];
  inventory: InventoryItem[];
}

export interface BillableItem {
  key: string;
  type: BillLineType;
  mod: string;
  pkg: string;
  desc: string;
  cost: number;
  client: number;
  pct: number;
}
