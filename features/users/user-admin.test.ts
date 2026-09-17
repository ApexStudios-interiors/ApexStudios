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
 * Seeded ids, as elsewhere: owner d1, admins d2/d3, site d5, client d6.
 */
const OWNER: UserAdminActor = { userId: "d1", role: "owner" };
const ADMIN: UserAdminActor = { userId: "d2", role: "admin" };
const SOLE_OWNER = { activeOwners: 1 };
const TWO_OWNERS = { activeOwners: 2 };

function target(overrides: Partial<UserAdminTarget> = {}): UserAdminTarget {
  return { id: "d5", role: "site", isActive: true, deletedAt: null, ...overrides };
}

const ownerTarget = target({ id: "dX", role: "owner" });

describe("userAdminRefusal — who may act on whom", () => {
  it.each(["owner", "admin", "site", "client"] as const)("owner may act on another %s", (role) => {
    expect(userAdminRefusal(OWNER, target({ id: "x", role }))).toBeNull();
  });

  it.each(["site", "client"] as const)("admin may act on a %s", (role) => {
    expect(userAdminRefusal(ADMIN, target({ id: "x", role }))).toBeNull();
  });

  it("refuses admin → owner: an admin who could demote the owner could lock them out", () => {
    expect(userAdminRefusal(ADMIN, target({ id: "d1", role: "owner" }))).toBe("forbidden_role");
  });

  it("refuses admin → another admin", () => {
    expect(userAdminRefusal(ADMIN, target({ id: "d3", role: "admin" }))).toBe("forbidden_role");
  });

  it.each([OWNER, ADMIN])("refuses acting on yourself ($role)", (actor) => {
    expect(userAdminRefusal(actor, target({ id: actor.userId, role: actor.role }))).toBe("self");
  });

  it("refuses a target the RLS-scoped read did not return (another org, or no such user)", () => {
    expect(userAdminRefusal(OWNER, null)).toBe("not_found");
  });

  it("refuses a soft-deleted target", () => {
    expect(userAdminRefusal(OWNER, target({ deletedAt: "2026-09-01T00:00:00Z" }))).toBe("not_found");
  });

  it.each(["site", "client"] as const)("refuses a %s caller outright", (role) => {
    expect(userAdminRefusal({ userId: "z", role }, target({ id: "d6", role: "client" }))).toBe(
      "forbidden_role"
    );
  });

  it("does NOT refuse a deactivated target — that is the one difference from the reset rule", () => {
    expect(userAdminRefusal(OWNER, target({ isActive: false }))).toBeNull();
    expect(canAdministerUser(OWNER, target({ isActive: false }))).toBe(true);
  });
});

describe("roleChangeRefusal", () => {
  it("allows owner → site becomes admin", () => {
    expect(roleChangeRefusal(OWNER, target(), "admin", SOLE_OWNER)).toBeNull();
  });

  it("allows admin → site becomes admin, because Add User already creates admins", () => {
    expect(roleChangeRefusal(ADMIN, target(), "admin", SOLE_OWNER)).toBeNull();
  });

  it.each([
    ["admin → owner", ADMIN, target({ id: "d1", role: "owner" }), "admin", "forbidden_role"],
    ["admin → admin", ADMIN, target({ id: "d3", role: "admin" }), "site", "forbidden_role"],
    ["self", ADMIN, target({ id: "d2", role: "admin" }), "site", "self"],
    ["other org / not found", OWNER, null, "site", "not_found"],
    ["deleted", OWNER, target({ deletedAt: "2026-09-01T00:00:00Z" }), "admin", "not_found"],
    ["last owner", OWNER, ownerTarget, "admin", "last_owner"],
  ] as const)("refuses %s", (_label, actor, found, nextRole, reason) => {
    expect(roleChangeRefusal(actor, found, nextRole, SOLE_OWNER)).toBe(reason);
  });

  it("refuses promoting anyone to owner — D8 names the one owner", () => {
    expect(roleChangeRefusal(OWNER, target(), "owner", TWO_OWNERS)).toBe("unassignable_role");
  });

  it("refuses a role the user already has rather than auditing a change that is not one", () => {
    expect(roleChangeRefusal(OWNER, target({ role: "admin" }), "admin", SOLE_OWNER)).toBe("no_change");
  });

  it("allows demoting an owner once a second active owner exists", () => {
    expect(roleChangeRefusal(OWNER, ownerTarget, "admin", TWO_OWNERS)).toBeNull();
  });

  it("does not count an already-inactive owner as the one holding the org up", () => {
    expect(
      roleChangeRefusal(OWNER, target({ role: "owner", isActive: false }), "admin", SOLE_OWNER)
    ).toBeNull();
  });
});

describe("activeChangeRefusal", () => {
  it("allows deactivating a site user", () => {
    expect(activeChangeRefusal(ADMIN, target(), false, SOLE_OWNER)).toBeNull();
  });

  it("allows reactivating one — deactivation is reversible, it is not a delete", () => {
    expect(activeChangeRefusal(ADMIN, target({ isActive: false }), true, SOLE_OWNER)).toBeNull();
  });

  it.each([
    ["admin → owner", ADMIN, target({ id: "d1", role: "owner" }), "forbidden_role"],
    ["admin → admin", ADMIN, target({ id: "d3", role: "admin" }), "forbidden_role"],
    ["self", OWNER, target({ id: "d1", role: "owner" }), "self"],
    ["other org / not found", OWNER, null, "not_found"],
    ["deleted", OWNER, target({ deletedAt: "2026-09-01T00:00:00Z" }), "not_found"],
    ["last owner", OWNER, ownerTarget, "last_owner"],
  ] as const)("refuses deactivating %s", (_label, actor, found, reason) => {
    expect(activeChangeRefusal(actor, found, false, SOLE_OWNER)).toBe(reason);
  });

  it("refuses deactivating someone already deactivated", () => {
    expect(activeChangeRefusal(OWNER, target({ isActive: false }), false, SOLE_OWNER)).toBe("no_change");
  });

  it("never refuses a REactivation for the last-owner reason — it adds an owner, it cannot remove one", () => {
    expect(
      activeChangeRefusal(OWNER, target({ role: "owner", isActive: false }), true, SOLE_OWNER)
    ).toBeNull();
  });
});

describe("roleControlRefusal — whether to enable the select at all", () => {
  it("is null when any role is a legal pick", () => {
    expect(roleControlRefusal(OWNER, target(), SOLE_OWNER)).toBeNull();
  });

  it("reports the reason that applies to every pick", () => {
    expect(roleControlRefusal(ADMIN, target({ id: "d1", role: "owner" }), TWO_OWNERS)).toBe("forbidden_role");
    expect(roleControlRefusal(OWNER, ownerTarget, SOLE_OWNER)).toBe("last_owner");
    expect(roleControlRefusal(OWNER, null, SOLE_OWNER)).toBe("not_found");
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
    const result = await changeUserRole(steps, OWNER, "d5", "admin");

    expect(result).toEqual({ status: "done", userId: "d5", from: "site", to: "admin" });
    expect(calls).toEqual(["loadTarget d5", "applyRole d5 admin", "revokeSessions d5"]);
  });

  it("asks how many owners are left only when the target could be the last one", async () => {
    const { calls } = fakeSteps(target());
    await changeUserRole(fakeSteps(target()).steps, OWNER, "d5", "admin");
    expect(calls).not.toContain("countActiveOwners");

    const owners = fakeSteps(ownerTarget, 2);
    await changeUserRole(owners.steps, OWNER, "dX", "admin");
    expect(owners.calls).toContain("countActiveOwners");
  });

  it.each([
    ["admin → owner", ADMIN, target({ id: "d1", role: "owner" }), "admin", 2, "forbidden_role"],
    ["admin → admin", ADMIN, target({ id: "d3", role: "admin" }), "site", 2, "forbidden_role"],
    ["self", ADMIN, target({ id: "d2", role: "admin" }), "site", 2, "self"],
    ["other org / not found", OWNER, null, "site", 2, "not_found"],
    ["deleted", OWNER, target({ deletedAt: "2026-09-01T00:00:00Z" }), "admin", 2, "not_found"],
    ["the last owner", OWNER, ownerTarget, "admin", 1, "last_owner"],
    ["a promotion to owner", OWNER, target(), "owner", 2, "unassignable_role"],
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
    ["admin → owner", ADMIN, target({ id: "d1", role: "owner" }), 2, "forbidden_role"],
    ["admin → admin", ADMIN, target({ id: "d3", role: "admin" }), 2, "forbidden_role"],
    ["self", OWNER, target({ id: "d1", role: "owner" }), 2, "self"],
    ["other org / not found", OWNER, null, 2, "not_found"],
    ["deleted", OWNER, target({ deletedAt: "2026-09-01T00:00:00Z" }), 2, "not_found"],
    ["the last owner", OWNER, ownerTarget, 1, "last_owner"],
    ["an already deactivated user", OWNER, target({ isActive: false }), 2, "no_change"],
  ] as const)("refuses deactivating %s, and bans nobody", async (_label, actor, found, owners, reason) => {
    const { steps, calls } = fakeSteps(found, owners);
    expect(await changeUserActive(steps, actor, found?.id ?? "elsewhere", false)).toEqual({
      status: "refused",
      reason,
    });
    expect(calls.filter((c) => !c.startsWith("loadTarget") && c !== "countActiveOwners")).toEqual([]);
  });
});
