import type { Role } from "./roles";

/**
 * The permission matrix from 01-hld.md §7.1, expressed once as data. Everything
 * else — the sidebar, route guards, action guards — reads this table rather
 * than re-deriving the rule.
 *
 * Three roles since 2026-10-05 (D66). `owner` is retired, and every capability
 * that was owner-only — setUserRole, deactivateUser, editBillingConstants —
 * is now an ordinary admin capability. There is no rank above admin.
 *
 * A test (lib/rbac/permissions.test.ts) ties this table to the HLD matrix row
 * for row. When the matrix changes, the doc and the code change together or
 * the test fails.
 */
export const CAN = {
  // ── Reads ────────────────────────────────────────────────────────────────
  viewDashboard: ["admin", "site", "client"],
  viewPackages: ["admin", "site", "client"],
  viewSchedule: ["admin", "site", "client"],
  viewDailyUpdates: ["admin", "site", "client"],
  viewInventory: ["admin", "site"],
  viewStockRequests: ["admin", "site"],
  viewApprovals: ["admin", "site", "client"],
  viewBilling: ["admin", "client"],
  viewUsers: ["admin"],
  seeInternalCost: ["admin"],
  // Site sees no money at all, not even the client-facing figure — this row is
  // deliberately narrower than viewBilling. See v_package_site (migration 0014).
  seeContractValue: ["admin", "client"],

  // ── Projects, packages, phases, tasks ────────────────────────────────────
  createEditProject: ["admin"],
  createEditPackage: ["admin"],
  createEditPhase: ["admin"],
  createEditTask: ["admin", "site"],
  setTaskProgress: ["admin", "site"],
  postDailyUpdate: ["admin", "site"],

  // ── Stock ────────────────────────────────────────────────────────────────
  raiseStockRequest: ["admin", "site"],
  approveStockRequest: ["admin"],
  markStockOrdered: ["admin"],
  markStockDelivered: ["admin", "site"],

  // ── Approvals ────────────────────────────────────────────────────────────
  requestApproval: ["admin", "site"],
  // Not in 01-hld.md §7.1's own matrix — build/08-approvals.md §2.4's own
  // row, same roles as requestApproval, "Pending approvals only" enforced by
  // status (features/approvals/service.ts's canAddPhotos), not by role.
  addSamplePhotos: ["admin", "site"],
  // Admin is excluded deliberately. 01-hld.md §7.1 — an Admin self-certifying
  // destroys the audit value of the whole chain. Do not add an Admin bypass,
  // including for testing.
  decideApproval: ["client"],

  // ── Billing ──────────────────────────────────────────────────────────────
  createBill: ["admin"],
  submitBill: ["admin"],
  // Admin is excluded deliberately, for the same reason as decideApproval.
  certifyBill: ["client"],
  recordPayment: ["admin"],
  editBillingConstants: ["admin"],

  // ── Users (build/03-auth-and-rbac.md §2.10) ─────────────────────────────
  inviteUser: ["admin"],
  // D66: an admin may change the role of, or deactivate, ANY user in the org
  // except themselves — admins are equal, so there is no target they outrank
  // or are outranked by. The self-exception is a property of the TARGET, so
  // this table (which maps an action to caller roles) cannot express it. The
  // real gate is `userAdminRefusal` in features/users/service.ts, re-checked
  // by rpc_set_user_role / rpc_set_user_active and, underneath both, by
  // trg_profiles_privilege_guard — which also keeps the org from losing its
  // last admin.
  setUserRole: ["admin"],
  deactivateUser: ["admin"],
  manageProjectMembers: ["admin"],

  // ── Impersonation (D20) ──────────────────────────────────────────────────
  startImpersonation: ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAN;

export function can(role: Role, cap: Capability): boolean {
  return (CAN[cap] as readonly Role[]).includes(role);
}
