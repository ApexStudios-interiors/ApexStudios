/**
 * The Role type. One definition, used by the database enum (migration 0001),
 * the JWT claim the auth hook stamps (02-lld.md §5.2), and every permission
 * check in the application.
 */
export type Role = "owner" | "admin" | "site" | "client";

export const ALL_ROLES: readonly Role[] = ["owner", "admin", "site", "client"];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  site: "Site Supervisor",
  client: "Client",
};
