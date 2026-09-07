import { Role } from "./types";

export type Section = "dashboard" | "packages" | "schedule" | "updates" | "stock" | "approvals" | "billing";

export const ALLOWED_SECTIONS: Record<Role, Section[]> = {
  admin: ["dashboard", "packages", "schedule", "updates", "stock", "approvals", "billing"],
  site: ["dashboard", "packages", "schedule", "updates", "stock", "approvals"],
  client: ["dashboard", "packages", "schedule", "updates", "approvals", "billing"],
};

/** Given a pathname like /projects/bhel/stock and its projectId, returns the matched section. */
export function sectionFromPath(pathname: string, projectId: string): Section {
  const rest = pathname.replace(`/projects/${projectId}`, "");
  if (rest.startsWith("/packages")) return "packages";
  if (rest.startsWith("/schedule")) return "schedule";
  if (rest.startsWith("/updates")) return "updates";
  if (rest.startsWith("/stock")) return "stock";
  if (rest.startsWith("/approvals")) return "approvals";
  if (rest.startsWith("/billing")) return "billing";
  return "dashboard";
}
