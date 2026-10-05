import { describe, expect, it } from "vitest";
import { CAN } from "./permissions";
import { ALL_ROLES, type Role } from "./roles";

/**
 * Ties CAN to 01-hld.md §7.1 row for row. When the matrix changes, this file
 * and the doc change together or this test fails — build/03-auth-and-rbac.md
 * §2.5.
 *
 * Transcribed directly from the table. Since D66 there are three roles, so the
 * HLD's "Admin" column maps straight onto `admin` — the owner column it used
 * to also stand for no longer exists.
 */
const HLD_7_1: Record<string, readonly Role[]> = {
  viewDashboard: ["admin", "site", "client"],
  viewInventory: ["admin", "site"],
  viewStockRequests: ["admin", "site"],
  viewApprovals: ["admin", "site", "client"],
  viewBilling: ["admin", "client"],
  viewUsers: ["admin"],
  seeInternalCost: ["admin"],
  seeContractValue: ["admin", "client"],
  createEditProject: ["admin"],
  createEditTask: ["admin", "site"],
  postDailyUpdate: ["admin", "site"],
  raiseStockRequest: ["admin", "site"],
  approveStockRequest: ["admin"],
  markStockOrdered: ["admin"],
  markStockDelivered: ["admin", "site"],
  requestApproval: ["admin", "site"],
  // The two deliberate negatives: an Admin approving or self-certifying
  // destroys the audit value of the chain. 01-hld.md §7.1 calls these out by
  // name as "deliberate negatives" — if either ever includes admin,
  // something has gone wrong, not been improved.
  decideApproval: ["client"],
  createBill: ["admin"],
  certifyBill: ["client"],
  recordPayment: ["admin"],
} as const;

describe("CAN matches 01-hld.md §7.1", () => {
  it.each(Object.entries(HLD_7_1))("%s", (capability, expectedRoles) => {
    const actual = CAN[capability as keyof typeof CAN];
    expect(actual, `${capability} is missing from CAN`).toBeDefined();
    expect(new Set(actual), `${capability} roles differ from the HLD matrix`).toEqual(new Set(expectedRoles));
  });

  it("decideApproval and certifyBill never include admin or owner, under any edit", () => {
    expect(CAN.decideApproval).not.toContain("admin");
    expect(CAN.decideApproval).not.toContain("owner");
    expect(CAN.certifyBill).not.toContain("admin");
    expect(CAN.certifyBill).not.toContain("owner");
  });

  it("every capability's role list is a subset of the four known roles", () => {
    for (const [cap, roles] of Object.entries(CAN)) {
      for (const role of roles) {
        expect(ALL_ROLES, `${cap} lists an unknown role: ${role}`).toContain(role);
      }
    }
  });
});
