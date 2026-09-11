import type {
  AppData,
  Approval,
  Bill,
  BillLine,
  BillableItem,
  InventoryItem,
  ModuleT,
  Package,
  Project,
  Role,
  StockRequest,
} from "./types";
import { CR, GST, L, MAS, RET } from "./data";

// D8: owner sees everything admin sees, plus user/billing-constant management
// handled separately in lib/rbac/permissions.ts. Every "admin" check below is
// paired with owner for that reason.
export const isMoney = (role: Role) => role === "admin" || role === "owner";
export const isClientRole = (role: Role) => role === "client";
export const isSiteRole = (role: Role) => role === "site";
export const canApprove = (role: Role) => role === "admin" || role === "owner";

export function fmt(n?: number | null): string {
  if (n == null) return "–";
  const neg = n < 0;
  const s = Math.round(Math.abs(n)).toString();
  let last = s.slice(-3);
  const rest = s.slice(0, -3);
  if (rest) last = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last;
  return (neg ? "-" : "") + "₹" + last;
}

export function fmtS(n?: number | null): string {
  if (n == null) return "–";
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= CR) return s + "₹" + (a / CR).toFixed(2) + " Cr";
  if (a >= L) return s + "₹" + (a / L).toFixed(2) + " L";
  return s + fmt(a);
}

export function pct(a: number, b: number): number {
  return b ? Math.round((a / b) * 100) : 0;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dmy(s?: string | null): string {
  if (!s) return "–";
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return "–";
  return `${d} ${MON[+m - 1]} ${y}`;
}

export function mno(p: Project, m: ModuleT): string {
  return String(p.modules.indexOf(m) + 1).padStart(2, "0");
}

export function amt(r: StockRequest): number {
  return (r.rate || 0) * (r.qty || 0);
}

// `committed`, `totals` and `projProgress` were deleted here
// (build/04-projects-packages-phases.md §6): all three had zero remaining
// callers once the portfolio page, dashboard, ModuleTable and ProjectCard
// moved to real data. `progress`, `factor`, `fmt` and `fmtS` stay — the build
// file's own instruction to delete all seven was checked against actual
// callers, not followed literally; those four are still load-bearing for
// pages this build does not convert (Schedule, Billing, Inventory, and the
// package-detail tabs still on AppContext). See docs/decisions.md D21 for
// the record of this correction.
//
// `progress` (task-duration-weighted package progress from mock data) is
// gone too, deleted in build/05-schedule-and-progress.md once its one
// caller — the project-level Schedule page — moved to real data. `phTasks`
// and `phStatus` below stay: MilestoneTable's Billing tab still needs them
// until Build 09.

export function factor(m: ModuleT, pkgId?: string): number {
  const k = m.packages.find((x) => x.id === pkgId);
  if (k && k.int) return k.alloc / k.int;
  return m.internal ? m.allocated / m.internal : 1;
}

export function phTasks(m: ModuleT, k: Package) {
  return m.tasks.filter((t) => t.pkg === k.id);
}

export type PhaseStatus = "Pending" | "Billable" | "Billed" | "Paid";

export function phStatus(data: AppData, m: ModuleT, k: Package): PhaseStatus {
  if (k.billedIn) {
    const b = data.bills.find((x) => x.id === k.billedIn);
    return b && b.status === "Paid" ? "Paid" : "Billed";
  }
  if (k.done) return "Billable";
  const ts = phTasks(m, k);
  return ts.length && ts.every((t) => t.p === 100) ? "Billable" : "Pending";
}

export function lineVal(l: BillLine): number {
  return Math.round((l.client * l.pct) / 100);
}

export function lineCost(l: BillLine): number {
  return Math.round((l.cost * l.pct) / 100);
}

export function billTotals(b: Bill) {
  const gross = b.lines.reduce((a, l) => a + lineVal(l), 0);
  const taxable = gross - (b.recovery || 0);
  const ret = Math.round((taxable * RET) / 100);
  const gst = Math.round((taxable * GST) / 100);
  const cost = b.lines.reduce((a, l) => a + lineCost(l), 0) - Math.round((b.recovery || 0) * 0.6);
  return { gross, taxable, ret, gst, net: taxable - ret + gst, cost, margin: taxable - cost };
}

export function billableItems(data: AppData, p: Project): BillableItem[] {
  const items: BillableItem[] = [];
  data.requests
    .filter((r) => r.proj === p.id && r.status === "Delivered" && !r.billedIn && amt(r) > 0)
    .forEach((r) => {
      const m = p.modules.find((x) => x.id === r.mod);
      if (!m) return;
      const client = Math.round(amt(r) * factor(m, r.pkg));
      items.push({
        key: "r:" + r.id,
        type: "material",
        mod: m.id,
        pkg: r.pkg || "",
        desc: `${r.id} ${r.item}, ${r.qty} ${r.unit}`,
        cost: amt(r),
        client,
        pct: MAS,
      });
    });
  p.modules.forEach((m) =>
    m.packages.forEach((k) => {
      if (phStatus(data, m, k) === "Billable") {
        items.push({
          key: "m:" + m.id + ":" + k.id,
          type: "milestone",
          mod: m.id,
          pkg: k.id,
          desc: `${k.name} complete`,
          cost: k.int || 0,
          client: k.alloc,
          pct: 100,
        });
      }
    })
  );
  return items;
}

export function bills(data: AppData, projId: string): Bill[] {
  return data.bills.filter((b) => b.proj === projId);
}

export function approvalsFor(data: AppData, projId: string): Approval[] {
  return data.approvals.filter((a) => a.proj === projId);
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
}

export type InventoryStatus = "OK" | "Low" | "Critical";

export function inventoryStatus(item: InventoryItem): InventoryStatus {
  if (item.qty <= 0) return "Critical";
  if (item.qty < item.reorderLevel) return "Low";
  return "OK";
}

export function inventoryValue(item: InventoryItem): number {
  return item.qty * item.unitCost;
}

export function inventoryFor(data: AppData, projId: string): InventoryItem[] {
  return data.inventory.filter((i) => i.proj === projId);
}

// `buildNotifications()` (and its `Notification` type) is retired — build/07
// replaced it with a live query over `v_notifications`
// (features/notifications/queries.ts). See docs/decisions.md and
// docs/build/07-stock-inventory-notifications.md §2.6.

// `buildSearchResults()` (and its `SearchResult` type) is retired — build/07
// replaced it with `searchAll`, a Server Action over real per-entity
// role-scoped queries (features/search/). See
// docs/build/07-stock-inventory-notifications.md §2.7.
