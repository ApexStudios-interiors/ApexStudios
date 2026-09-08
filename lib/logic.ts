import { AppData, Approval, Bill, BillLine, BillableItem, InventoryItem, ModuleT, Package, Project, Role, StockRequest } from "./types";
import { CR, GST, L, MAS, RET } from "./data";

export const isMoney = (role: Role) => role === "admin";
export const isClientRole = (role: Role) => role === "client";
export const isSiteRole = (role: Role) => role === "site";
export const canApprove = (role: Role) => role === "admin";

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
  return `${d} ${MON[+m - 1]} ${y}`;
}

export function mno(p: Project, m: ModuleT): string {
  return String(p.modules.indexOf(m) + 1).padStart(2, "0");
}

export function amt(r: StockRequest): number {
  return (r.rate || 0) * (r.qty || 0);
}

export function committed(data: AppData, projId: string, m: ModuleT, pkg?: string): number {
  return data.requests
    .filter(
      (r) =>
        r.proj === projId &&
        r.mod === m.id &&
        (!pkg || r.pkg === pkg) &&
        ["Approved", "Ordered", "Delivered"].includes(r.status)
    )
    .reduce((a, r) => a + amt(r), 0);
}

export function totals(data: AppData, p: Project) {
  let alloc = 0,
    int = 0,
    c = 0;
  p.modules.forEach((m) => {
    alloc += m.allocated;
    int += m.internal || 0;
    c += committed(data, p.id, m);
  });
  return { alloc, int, c };
}

export function progress(m: ModuleT): number {
  const ts = m.tasks;
  const d = ts.reduce((a, t) => a + t.d, 0);
  return d ? Math.round(ts.reduce((a, t) => a + t.p * t.d, 0) / d) : 0;
}

export function projProgress(p: Project): number {
  const a = p.modules.reduce((x, m) => x + m.allocated, 0);
  return a ? Math.round(p.modules.reduce((x, m) => x + progress(m) * m.allocated, 0) / a) : 0;
}

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

export interface Notification {
  id: string;
  text: string;
  sub: string;
  href: string;
}

/** Flat, role-scoped list of things needing attention across every project. */
export function buildNotifications(data: AppData, role: Role): Notification[] {
  const items: Notification[] = [];
  const projectName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? id;

  if (role !== "client") {
    data.requests
      .filter((r) => r.status === "Pending")
      .forEach((r) =>
        items.push({ id: "req-" + r.id, text: r.item, sub: `Stock request · ${projectName(r.proj)}`, href: `/projects/${r.proj}/stock` })
      );
  }

  if (role === "client") {
    data.approvals
      .filter((a) => a.status === "Pending")
      .forEach((a) =>
        items.push({ id: "ap-" + a.id, text: a.item, sub: `Approval needed · ${projectName(a.proj)}`, href: `/projects/${a.proj}/approvals` })
      );
    data.bills
      .filter((b) => b.status === "Submitted")
      .forEach((b) =>
        items.push({ id: "bill-" + b.id, text: `Bill ${b.id}`, sub: `Awaiting your approval · ${projectName(b.proj)}`, href: `/projects/${b.proj}/billing` })
      );
  } else {
    data.bills
      .filter((b) => b.status === "Submitted")
      .forEach((b) =>
        items.push({ id: "bill-" + b.id, text: `Bill ${b.id} submitted`, sub: `Ready to certify · ${projectName(b.proj)}`, href: `/projects/${b.proj}/billing` })
      );
    data.inventory
      .filter((i) => inventoryStatus(i) !== "OK")
      .forEach((i) =>
        items.push({
          id: "inv-" + i.id,
          text: i.name,
          sub: `${inventoryStatus(i)} stock · ${projectName(i.proj)}`,
          href: `/projects/${i.proj}/inventory`,
        })
      );
  }

  return items;
}

export interface SearchResult {
  id: string;
  category: string;
  text: string;
  sub: string;
  href: string;
}

/** Role-aware, cross-project search over projects, packages, requests, approvals, bills, inventory, and users. */
export function buildSearchResults(data: AppData, role: Role, query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const match = (s: string) => s.toLowerCase().includes(q);
  const projectName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? id;
  const results: SearchResult[] = [];

  data.projects.forEach((p) => {
    if (match(p.name) || match(p.client)) {
      results.push({ id: "proj-" + p.id, category: "Projects", text: p.name, sub: p.client, href: `/projects/${p.id}` });
    }
    p.modules.forEach((m) => {
      if (match(m.name)) {
        results.push({ id: "mod-" + m.id, category: "Packages", text: m.name, sub: p.name, href: `/projects/${p.id}/packages/${m.id}` });
      }
    });
  });

  if (role !== "client") {
    data.requests.forEach((r) => {
      if (match(r.item) || match(r.id)) {
        results.push({
          id: "req-" + r.id,
          category: "Stock Requests",
          text: r.item,
          sub: `${r.id} · ${projectName(r.proj)}`,
          href: `/projects/${r.proj}/stock`,
        });
      }
    });
    data.inventory.forEach((i) => {
      if (match(i.name) || match(i.category)) {
        results.push({
          id: "inv-" + i.id,
          category: "Inventory",
          text: i.name,
          sub: `${i.category} · ${projectName(i.proj)}`,
          href: `/projects/${i.proj}/inventory`,
        });
      }
    });
  }

  data.approvals.forEach((a) => {
    if (match(a.item) || match(a.id)) {
      results.push({
        id: "ap-" + a.id,
        category: "Approvals",
        text: a.item,
        sub: `${a.id} · ${projectName(a.proj)}`,
        href: `/projects/${a.proj}/approvals`,
      });
    }
  });

  if (role !== "site") {
    data.bills.forEach((b) => {
      if (match(b.id)) {
        results.push({ id: "bill-" + b.id, category: "Bills", text: b.id, sub: projectName(b.proj), href: `/projects/${b.proj}/billing` });
      }
    });
  }

  if (role === "admin") {
    data.team.forEach((t, idx) => {
      if (match(t.n)) {
        results.push({ id: "user-" + idx, category: "Users", text: t.n, sub: t.t, href: "/users" });
      }
    });
  }

  return results;
}
