import { type Capability, can } from "./permissions";
import type { Role } from "./roles";

/**
 * Replaces lib/nav.ts (build/03-auth-and-rbac.md §2.5). Same `Section` union
 * and `sectionFromPath` as before — the only change is that `ALLOWED_SECTIONS`
 * is now DERIVED from `CAN` instead of hand-duplicated, so the two cannot
 * silently drift, and `owner` is a real role rather than an alias.
 */
export type Section =
  "dashboard" | "packages" | "schedule" | "updates" | "inventory" | "stock" | "approvals" | "billing";

const SECTIONS: readonly Section[] = [
  "dashboard",
  "packages",
  "schedule",
  "updates",
  "inventory",
  "stock",
  "approvals",
  "billing",
];

/** Which capability gates each section. 02-lld.md §8.2. */
const SECTION_CAPABILITY: Record<Section, Capability> = {
  dashboard: "viewDashboard",
  packages: "viewPackages",
  schedule: "viewSchedule",
  updates: "viewDailyUpdates",
  inventory: "viewInventory",
  stock: "viewStockRequests",
  approvals: "viewApprovals",
  billing: "viewBilling",
};

function sectionsFor(role: Role): Section[] {
  return SECTIONS.filter((s) => can(role, SECTION_CAPABILITY[s]));
}

export const ALLOWED_SECTIONS: Record<Role, Section[]> = {
  owner: sectionsFor("owner"),
  admin: sectionsFor("admin"),
  site: sectionsFor("site"),
  client: sectionsFor("client"),
};

/** "Billing" reads as "Bills" for a client — 02-lld.md §8.2. */
export function sectionLabel(section: Section, role: Role): string {
  if (section === "billing") return role === "client" ? "Bills" : "Billing";
  if (section === "approvals") return "Approvals";
  const labels: Record<Section, string> = {
    dashboard: "Dashboard",
    packages: "Packages",
    schedule: "Schedule",
    updates: "Daily Updates",
    inventory: "Inventory",
    stock: "Stock Requests",
    approvals: "Approvals",
    billing: "Billing",
  };
  return labels[section];
}

/** Given a pathname like /projects/bhel/stock and its projectId, returns the matched section. */
export function sectionFromPath(pathname: string, projectId: string): Section {
  const rest = pathname.replace(`/projects/${projectId}`, "");
  if (rest.startsWith("/packages")) return "packages";
  if (rest.startsWith("/schedule")) return "schedule";
  if (rest.startsWith("/updates")) return "updates";
  if (rest.startsWith("/inventory")) return "inventory";
  if (rest.startsWith("/stock")) return "stock";
  if (rest.startsWith("/approvals")) return "approvals";
  if (rest.startsWith("/billing")) return "billing";
  return "dashboard";
}
