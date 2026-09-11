import type { Role } from "./roles";

/**
 * The permission matrix from 01-hld.md §7.1, expressed once as data. Everything
 * else — the sidebar, route guards, action guards — reads this table rather
 * than re-deriving the rule.
 *
 * `owner` is not a column in the HLD's own matrix (it predates D8). It carries
 * every `admin` capability plus the owner-only actions build/03-auth-and-rbac.md
 * §2.10 adds: setUserRole, deactivateUser, editBillingConstants.
 *
 * A test (lib/rbac/permissions.test.ts) ties this table to the HLD matrix row
 * for row. When the matrix changes, the doc and the code change together or
 * the test fails.
 */
export const CAN = {
  // ── Reads ────────────────────────────────────────────────────────────────
  viewDashboard: ["owner", "admin", "site", "client"],
  viewPackages: ["owner", "admin", "site", "client"],
  viewSchedule: ["owner", "admin", "site", "client"],
  viewDailyUpdates: ["owner", "admin", "site", "client"],
  viewInventory: ["owner", "admin", "site"],
  viewStockRequests: ["owner", "admin", "site"],
  viewApprovals: ["owner", "admin", "site", "client"],
  viewBilling: ["owner", "admin", "client"],
  viewUsers: ["owner", "admin"],
  seeInternalCost: ["owner", "admin"],
  // Site sees no money at all, not even the client-facing figure — this row is
  // deliberately narrower than viewBilling. See v_package_site (migration 0014).
  seeContractValue: ["owner", "admin", "client"],

  // ── Projects, packages, phases, tasks ────────────────────────────────────
  createEditProject: ["owner", "admin"],
  createEditPackage: ["owner", "admin"],
  createEditPhase: ["owner", "admin"],
  createEditTask: ["owner", "admin", "site"],
  setTaskProgress: ["owner", "admin", "site"],
  postDailyUpdate: ["owner", "admin", "site"],

  // ── Stock ────────────────────────────────────────────────────────────────
  raiseStockRequest: ["owner", "admin", "site"],
  approveStockRequest: ["owner", "admin"],
  markStockOrdered: ["owner", "admin"],
  markStockDelivered: ["owner", "admin", "site"],

  // ── Approvals ────────────────────────────────────────────────────────────
  requestApproval: ["owner", "admin", "site"],
  // Not in 01-hld.md §7.1's own matrix — build/08-approvals.md §2.4's own
  // row, same roles as requestApproval, "Pending approvals only" enforced by
  // status (features/approvals/service.ts's canAddPhotos), not by role.
  addSamplePhotos: ["owner", "admin", "site"],
  // Admin is excluded deliberately. 01-hld.md §7.1 — an Admin self-certifying
  // destroys the audit value of the whole chain. Do not add an Admin bypass,
  // including for testing.
  decideApproval: ["client"],

  // ── Billing ──────────────────────────────────────────────────────────────
  createBill: ["owner", "admin"],
  submitBill: ["owner", "admin"],
  // Admin is excluded deliberately, for the same reason as decideApproval.
  certifyBill: ["client"],
  recordPayment: ["owner", "admin"],
  editBillingConstants: ["owner"],

  // ── Users (build/03-auth-and-rbac.md §2.10) ─────────────────────────────
  inviteUser: ["owner", "admin"],
  setUserRole: ["owner"],
  deactivateUser: ["owner"],
  manageProjectMembers: ["owner", "admin"],

  // ── Impersonation (D20) ──────────────────────────────────────────────────
  startImpersonation: ["owner", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAN;

export function can(role: Role, cap: Capability): boolean {
  return (CAN[cap] as readonly Role[]).includes(role);
}
