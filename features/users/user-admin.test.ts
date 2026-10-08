import { describe, expect, it } from "vitest";
import {
  activeChangeRefusal,
  canAdministerUser,
  changeUserActive,
  changeUserRole,
  roleChangeRefusal,
  roleControlRefusal,
  userAdminRefusal,
  type UserAdminActor,
  type UserAdminSteps,
  type UserAdminTarget,
} from "./service";
import { setUserActiveSchema, setUserRoleSchema } from "./schema";

/**
 * Who may change whose role, who may deactivate whom, and what an allowed one
 * actually does. The database enforces the same rule a second time
 * (supabase/tests/13_user_role_and_deactivation_test.sql); this is the copy the
 * page and the action share.
 *
 * Seeded ids, as elsewhere: admins d1/d2/d3, site d5, client d6. Since D66
 * there are three roles and admins are equal — `OTHER_ADMIN` exists to prove
 * that an admin may now act on a peer, which used to be refused.
 *
 * `activeOwners` keeps its name but counts active ADMINS: the invariant it
 * guards became "the org must not lose its last admin" (D66).
 */
const ADMIN: UserAdminActor = { userId: "d2", role: "admin" };
const OTHER_ADMIN: UserAdminActor = { userId: "d1", role: "admin" };
const SOLE_ADMIN = { activeOwners: 1 };
const TWO_ADMINS = { activeOwners: 2 };

function target(overrides: Partial<UserAdminTarget> = {}): UserAdminTarget {
  return { id: "d5", role: "site", isActive: true, deletedAt: null, ...overrides };
}

const adminTarget = target({ id: "dX", role: "admin" });

describe("userAdminRefusal — who may act on whom", () => {
  it.each(["admin", "site", "client"] as const)("an admin may act on any %s", (role) => {
    expect(userAdminRefusal(ADMIN, target({ id: "x", role }))).toBeNull();
  });

  it("D66: an admin may act on a PEER admin, which used to be refused", () => {
    // There is no rank above admin any more, so there is no colleague an
    // admin is protected from. This is the capability the owner role used to
    // hold on its own.
    expect(userAdminRefusal(ADMIN, target({ id: "d3", role: "admin" }))).toBeNull();
  });

  it("refuses acting on yourself — the one target rule left", () => {
    expect(userAdminRefusal(ADMIN, target({ id: ADMIN.userId, role: ADMIN.role }))).toBe("self");
  });

  it("refuses a target the RLS-scoped read did not return (another org, or no such user)", () => {
    expect(userAdminRefusal(ADMIN, null)).toBe("not_found");
  });

  it("refuses a soft-deleted target", () => {
    expect(userAdminRefusal(ADMIN, target({ deletedAt: "2026-09-01T00:00:00Z" }))).toBe("not_found");
  });

  it.each(["site", "client"] as const)("refuses a %s caller outright", (role) => {
    expect(userAdminRefusal({ userId: "z", role }, target({ id: "d6", role: "client" }))).toBe(
      "forbidden_role"
    );
  });

  it("does NOT refuse a deactivated target — that is the one difference from the reset rule", () => {
    expect(userAdminRefusal(ADMIN, target({ isActive: false }))).toBeNull();
    expect(canAdministerUser(ADMIN, target({ isActive: false }))).toBe(true);
  });
});

describe("roleChangeRefusal", () => {
  it("allows a site user to become admin", () => {
    expect(roleChangeRefusal(ADMIN, target(), "admin", TWO_ADMINS)).toBeNull();
  });

  it("D66: allows an admin to demote a PEER admin", () => {
    expect(roleChangeRefusal(ADMIN, target({ id: "d3", role: "admin" }), "site", TWO_ADMINS)).toBeNull();
  });

  it.each([
    ["self", ADMIN, target({ id: "d2", role: "admin" }), "site", "self"],
    ["other org / not found", ADMIN, null, "site", "not_found"],
    ["deleted", ADMIN, target({ deletedAt: "2026-09-01T00:00:00Z" }), "admin", "not_found"],
    ["the last active admin", OTHER_ADMIN, adminTarget, "site", "last_owner"],
  ] as const)("refuses %s", (_label, actor, found, nextRole, reason) => {
    expect(roleChangeRefusal(actor, found, nextRole, SOLE_ADMIN)).toBe(reason);
  });

  it("refuses assigning the retired owner role", () => {
    // The enum value survives for audit_log's history; it is not a role
    // anyone can be given (D66).
    expect(roleChangeRefusal(ADMIN, target(), "owner" as never, TWO_ADMINS)).toBe("unassignable_role");
  });

  it("refuses a role the user already has rather than auditing a change that is not one", () => {
    expect(roleChangeRefusal(ADMIN, target({ id: "dZ", role: "admin" }), "admin", TWO_ADMINS)).toBe(
      "no_change"
    );
  });

  it("allows demoting an admin once a second active admin exists", () => {
    expect(roleChangeRefusal(ADMIN, adminTarget, "site", TWO_ADMINS)).toBeNull();
  });

  it("does not count an already-inactive admin as the one holding the org up", () => {
    expect(
      roleChangeRefusal(ADMIN, target({ id: "dZ", role: "admin", isActive: false }), "site", SOLE_ADMIN)
    ).toBeNull();
  });
});

describe("activeChangeRefusal", () => {
  it("allows deactivating a site user", () => {
    expect(activeChangeRefusal(ADMIN, target(), false, SOLE_ADMIN)).toBeNull();
  });

  it("allows reactivating one — deactivation is reversible, it is not a delete", () => {
    expect(activeChangeRefusal(ADMIN, target({ isActive: false }), true, SOLE_ADMIN)).toBeNull();
  });

  it.each([
    ["self", ADMIN, target({ id: "d2", role: "admin" }), "self"],
    ["other org / not found", ADMIN, null, "not_found"],
    ["deleted", ADMIN, target({ deletedAt: "2026-09-01T00:00:00Z" }), "not_found"],
    ["the last active admin", OTHER_ADMIN, adminTarget, "last_owner"],
  ] as const)("refuses deactivating %s", (_label, actor, found, reason) => {
    expect(activeChangeRefusal(actor, found, false, SOLE_ADMIN)).toBe(reason);
  });

  it("refuses deactivating someone already deactivated", () => {
    expect(activeChangeRefusal(ADMIN, target({ isActive: false }), false, SOLE_ADMIN)).toBe("no_change");
  });

  it("never refuses a REactivation for the last-admin reason — it adds an admin, it cannot remove one", () => {
    expect(
      activeChangeRefusal(ADMIN, target({ id: "dZ", role: "admin", isActive: false }), true, SOLE_ADMIN)
    ).toBeNull();
  });
});

describe("roleControlRefusal — whether to enable the select at all", () => {
  it("is null when any role is a legal pick", () => {
    expect(roleControlRefusal(ADMIN, target(), SOLE_ADMIN)).toBeNull();
  });

  it("reports the reason that applies to every pick", () => {
    expect(roleControlRefusal(OTHER_ADMIN, adminTarget, SOLE_ADMIN)).toBe("last_owner");
    expect(roleControlRefusal(ADMIN, null, SOLE_ADMIN)).toBe("not_found");
  });
});

describe("the action input schemas", () => {
  it("refuses owner as a role a request may ask for", () => {
    expect(setUserRoleSchema.safeParse({ userId: crypto.randomUUID(), role: "owner" }).success).toBe(false);
  });

  it.each(["admin", "site", "client"])("accepts %s", (role) => {
    expect(setUserRoleSchema.safeParse({ userId: crypto.randomUUID(), role }).success).toBe(true);
  });

  it("takes only an id and a flag for activation — never a role", () => {
    expect(setUserActiveSchema.safeParse({ userId: crypto.randomUUID(), isActive: false }).success).toBe(
      true
    );
    expect(setUserActiveSchema.safeParse({ userId: "not-a-uuid", isActive: false }).success).toBe(false);
  });
});

function fakeSteps(found: UserAdminTarget | null, activeOwners = 1) {
  const calls: string[] = [];
  const steps: UserAdminSteps = {
    loadTarget: async (id) => {
      calls.push(`loadTarget ${id}`);
      return found;
    },
    countActiveOwners: async () => {
      calls.push("countActiveOwners");
      return activeOwners;
    },
    applyRole: async (id, role) => {
      calls.push(`applyRole ${id} ${role}`);
    },
    applyActive: async (id, isActive) => {
      calls.push(`applyActive ${id} ${isActive}`);
    },
    revokeSessions: async (id) => {
      calls.push(`revokeSessions ${id}`);
    },
    setBanned: async (id, banned) => {
      calls.push(`setBanned ${id} ${banned}`);
    },
  };
  return { steps, calls };
}

describe("changeUserRole", () => {
  it("changes the role first, then ends the sessions that still carry the old one", async () => {
    const { steps, calls } = fakeSteps(target());
    const result = await changeUserRole(steps, ADMIN, "d5", "admin");

    expect(result).toEqual({ status: "done", userId: "d5", from: "site", to: "admin" });
    expect(calls).toEqual(["loadTarget d5", "applyRole d5 admin", "revokeSessions d5"]);
  });

  it("asks how many owners are left only when the target could be the last one", async () => {
    const { calls } = fakeSteps(target());
    await changeUserRole(fakeSteps(target()).steps, ADMIN, "d5", "admin");
    expect(calls).not.toContain("countActiveOwners");

    const owners = fakeSteps(adminTarget, 2);
    await changeUserRole(owners.steps, ADMIN, "dX", "admin");
    expect(owners.calls).toContain("countActiveOwners");
  });

  it.each([
    ["self", ADMIN, target({ id: "d2", role: "admin" }), "site", 2, "self"],
    ["other org / not found", ADMIN, null, "site", 2, "not_found"],
    ["deleted", ADMIN, target({ deletedAt: "2026-09-01T00:00:00Z" }), "admin", 2, "not_found"],
    ["the last active admin", OTHER_ADMIN, adminTarget, "site", 1, "last_owner"],
    ["a promotion to the retired owner role", ADMIN, target(), "owner" as never, 2, "unassignable_role"],
  ] as const)(
    "refuses %s without changing anything or revoking a session",
    async (_label, actor, found, nextRole, owners, reason) => {
      const { steps, calls } = fakeSteps(found, owners);
      expect(await changeUserRole(steps, actor, found?.id ?? "elsewhere", nextRole)).toEqual({
        status: "refused",
        reason,
      });
      expect(calls.filter((c) => c.startsWith("applyRole") || c.startsWith("revokeSessions"))).toEqual([]);
    }
  );

  it("does not revoke a session when the database refuses the change", async () => {
    const { steps, calls } = fakeSteps(target());
    steps.applyRole = async () => {
      throw new Error("FORBIDDEN: an admin may act only on site and client users");
    };
    await expect(changeUserRole(steps, ADMIN, "d5", "client")).rejects.toThrow("FORBIDDEN");
    expect(calls).not.toContain("revokeSessions d5");
  });
});

describe("changeUserActive", () => {
  it("deactivates, bans the account so it cannot sign back in, then ends its sessions", async () => {
    const { steps, calls } = fakeSteps(target());
    const result = await changeUserActive(steps, ADMIN, "d5", false);

    expect(result).toEqual({ status: "done", userId: "d5", isActive: false });
    expect(calls).toEqual([
      "loadTarget d5",
      "applyActive d5 false",
      "setBanned d5 true",
      "revokeSessions d5",
    ]);
  });

  it("reactivating lifts the ban and ends nobody's session", async () => {
    const { steps, calls } = fakeSteps(target({ isActive: false }));
    const result = await changeUserActive(steps, ADMIN, "d5", true);

    expect(result).toEqual({ status: "done", userId: "d5", isActive: true });
    expect(calls).toEqual(["loadTarget d5", "applyActive d5 true", "setBanned d5 false"]);
  });

  it.each([
    ["self", ADMIN, target({ id: "d2", role: "admin" }), 2, "self"],
    ["other org / not found", ADMIN, null, 2, "not_found"],
    ["deleted", ADMIN, target({ deletedAt: "2026-09-01T00:00:00Z" }), 2, "not_found"],
    ["the last owner", ADMIN, adminTarget, 1, "last_owner"],
    ["an already deactivated user", ADMIN, target({ isActive: false }), 2, "no_change"],
  ] as const)("refuses deactivating %s, and bans nobody", async (_label, actor, found, owners, reason) => {
    const { steps, calls } = fakeSteps(found, owners);
    expect(await changeUserActive(steps, actor, found?.id ?? "elsewhere", false)).toEqual({
      status: "refused",
      reason,
    });
    expect(calls.filter((c) => !c.startsWith("loadTarget") && c !== "countActiveOwners")).toEqual([]);
  });
});
