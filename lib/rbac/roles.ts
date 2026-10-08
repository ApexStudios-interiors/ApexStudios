/**
 * The Role type. One definition, used by the database enum (migration 0001),
 * the JWT claim the auth hook stamps (02-lld.md §5.2), and every permission
 * check in the application.
 *
 * Three roles since 2026-10-05 (D66). `owner` is retired: every capability it
 * had is an admin capability now, and the single owner account became an
 * admin. The database enum still CARRIES 'owner' because `audit_log.actor_role`
 * holds historical rows recording what an owner did, and that table is
 * append-only — so the value survives as history while nothing can produce it.
 * It is deliberately absent from this union: no live code path should be able
 * to name a role that no user can hold.
 */
export type Role = "admin" | "site" | "client";

export const ALL_ROLES: readonly Role[] = ["admin", "site", "client"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  site: "Site Supervisor",
  client: "Client",
};

/**
 * Narrows the DATABASE enum to a live `Role`.
 *
 * `app_role` still carries the retired `'owner'` value because
 * `audit_log.actor_role` holds historical rows and that table is append-only
 * (D66). No `profiles.role` carries it after migration 20261005090001, and
 * the privilege guard refuses to assign it — so this should never see one.
 *
 * It maps rather than throws if it ever does: `owner` meant "everything an
 * admin can do", so `admin` is the honest reading, and a stray row must not
 * take a page down. Use this wherever a role is read out of the database into
 * application code, instead of casting.
 */
export function toRole(dbRole: string): Role {
  return dbRole === "owner" ? "admin" : (dbRole as Role);
}
