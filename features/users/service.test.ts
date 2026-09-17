import { describe, expect, it, vi } from "vitest";
import { addUserSchema, createClientLoginSchema } from "./schema";
import {
  canResetPassword,
  emailForUsername,
  generatePassword,
  GENERATED_PASSWORD_LENGTH,
  passwordResetRefusal,
  provisionAccount,
  resetAccountPassword,
  signInEmail,
  usernameForEmail,
  type ProvisionSteps,
  type ResetActor,
  type ResetSteps,
  type ResetTarget,
} from "./service";

describe("emailForUsername", () => {
  it("derives the seeded staff domain", () => {
    expect(emailForUsername("suresh")).toBe("suresh@beapex.in");
  });
});

describe("addUserSchema", () => {
  it("normalises the username to trimmed lower case", () => {
    const parsed = addUserSchema.parse({ username: "  Suresh.K ", role: "site" });
    expect(parsed.username).toBe("suresh.k");
  });

  it.each(["a", "-lead", "trail.", "has space", "at@sign", "x".repeat(33)])("rejects %j", (username) => {
    expect(addUserSchema.safeParse({ username, role: "site" }).success).toBe(false);
  });

  it("refuses the owner role", () => {
    expect(addUserSchema.safeParse({ username: "boss", role: "owner" }).success).toBe(false);
  });

  // D51: a client login is created from a project, never from Add User.
  it("refuses the client role", () => {
    expect(addUserSchema.safeParse({ username: "tvrao", role: "client" }).success).toBe(false);
  });

  it.each(["admin", "site"])("accepts the %s role", (role) => {
    expect(addUserSchema.safeParse({ username: "staff", role }).success).toBe(true);
  });
});

describe("createClientLoginSchema", () => {
  const projectId = "00000000-0000-4000-8000-0000000000c1";

  it("takes a project and a username, and no role", () => {
    const parsed = createClientLoginSchema.parse({ projectId, username: " TVRao ", role: "admin" });
    expect(parsed).toEqual({ projectId, username: "tvrao" });
  });

  it("requires a real project id", () => {
    expect(createClientLoginSchema.safeParse({ projectId: "bhel", username: "tvrao" }).success).toBe(false);
  });
});

describe("signInEmail", () => {
  it("turns a username into the Apex address", () => {
    expect(signInEmail(" Suresh ")).toBe("suresh@beapex.in");
  });

  it("passes a full address through unchanged", () => {
    expect(signInEmail("TVRao@example.invalid")).toBe("tvrao@example.invalid");
  });
});

describe("provisionAccount", () => {
  function fakeSteps(overrides: Partial<ProvisionSteps> = {}) {
    const calls: string[] = [];
    const steps: ProvisionSteps = {
      createAuthUser: async ({ email }) => {
        calls.push(`createAuthUser ${email}`);
        return { ok: true, userId: "u1" };
      },
      deleteAuthUser: async (userId) => {
        calls.push(`deleteAuthUser ${userId}`);
      },
      insertProfile: async (userId) => {
        calls.push(`insertProfile ${userId}`);
      },
      ...overrides,
    };
    return { steps, calls };
  }

  it("creates the auth user, then the profile, then the extra step", async () => {
    const { steps, calls } = fakeSteps({
      afterProfile: async (userId) => {
        calls.push(`afterProfile ${userId}`);
      },
    });
    const result = await provisionAccount(steps, "tvrao");
    expect(calls).toEqual(["createAuthUser tvrao@beapex.in", "insertProfile u1", "afterProfile u1"]);
    expect(result).toMatchObject({ status: "created", userId: "u1", email: "tvrao@beapex.in" });
    expect(result.status === "created" && result.password).toHaveLength(GENERATED_PASSWORD_LENGTH);
  });

  it("reports a taken username without creating anything else", async () => {
    const { steps, calls } = fakeSteps({
      createAuthUser: async () => ({ ok: false, reason: "email_exists" }),
    });
    expect(await provisionAccount(steps, "suresh")).toEqual({ status: "username_taken" });
    expect(calls).toEqual([]);
  });

  it("deletes the auth user when the profile insert fails", async () => {
    const afterProfile = vi.fn();
    const { steps, calls } = fakeSteps({
      insertProfile: async () => {
        throw new Error("profiles_insert denied");
      },
      afterProfile,
    });
    await expect(provisionAccount(steps, "tvrao")).rejects.toThrow("profiles_insert denied");
    expect(calls).toEqual(["createAuthUser tvrao@beapex.in", "deleteAuthUser u1"]);
    expect(afterProfile).not.toHaveBeenCalled();
  });

  it("deletes the auth user when the membership step fails", async () => {
    const { steps, calls } = fakeSteps({
      afterProfile: async () => {
        throw new Error("NOT_FOUND: project or profile");
      },
    });
    await expect(provisionAccount(steps, "tvrao")).rejects.toThrow("NOT_FOUND");
    expect(calls).toEqual(["createAuthUser tvrao@beapex.in", "insertProfile u1", "deleteAuthUser u1"]);
  });

  it("surfaces the original failure, and reports the orphan, if cleanup also fails", async () => {
    const onOrphan = vi.fn();
    const { steps } = fakeSteps({
      afterProfile: async () => {
        throw new Error("membership failed");
      },
      deleteAuthUser: async () => {
        throw new Error("gotrue down");
      },
      onOrphan,
    });
    await expect(provisionAccount(steps, "tvrao")).rejects.toThrow("membership failed");
    expect(onOrphan).toHaveBeenCalledWith("u1", expect.any(Error));
  });

  it("never puts the password in the error", async () => {
    let password = "";
    const { steps } = fakeSteps({
      createAuthUser: async (input) => {
        password = input.password;
        return { ok: true, userId: "u1" };
      },
      insertProfile: async () => {
        throw new Error("boom");
      },
    });
    const error = await provisionAccount(steps, "tvrao").catch((e: unknown) => e);
    expect(password).toHaveLength(GENERATED_PASSWORD_LENGTH);
    expect(String(error)).not.toContain(password);
  });
});

describe("generatePassword", () => {
  it("is long and covers every character class", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword();
      expect(pw).toHaveLength(GENERATED_PASSWORD_LENGTH);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[2-9]/);
      expect(pw).toMatch(/[!@#$%^&*\-_=+?]/);
      expect(pw).not.toMatch(/[0O1lI]/);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generatePassword()));
    expect(seen.size).toBe(500);
  });

  it("rejects out-of-range draws instead of reducing them with a bias", () => {
    // First draw is above every alphabet's rejection limit, so it must be
    // discarded; the rest are 0. A modulo-only implementation would use it.
    let calls = 0;
    const pw = generatePassword((buf) => {
      buf[0] = calls++ === 0 ? 0xffff_ffff : 0;
      return buf;
    });
    expect(calls).toBeGreaterThan(GENERATED_PASSWORD_LENGTH + 4);
    expect(pw).toHaveLength(GENERATED_PASSWORD_LENGTH);
  });
});

describe("usernameForEmail", () => {
  it("drops the Apex domain", () => {
    expect(usernameForEmail("Suresh@beapex.in")).toBe("suresh");
  });

  it("keeps any other address whole, as the sign-in form accepts it", () => {
    expect(usernameForEmail("tvrao@example.invalid")).toBe("tvrao@example.invalid");
    expect(signInEmail(usernameForEmail("tvrao@example.invalid"))).toBe("tvrao@example.invalid");
  });
});

// D52. Seeded ids: owner d1, admins d2/d3, site d5, client d6.
const OWNER: ResetActor = { userId: "d1", role: "owner" };
const ADMIN: ResetActor = { userId: "d2", role: "admin" };

function target(overrides: Partial<ResetTarget> = {}): ResetTarget {
  return {
    id: "d5",
    role: "site",
    isActive: true,
    deletedAt: null,
    email: "ravi@beapex.in",
    ...overrides,
  };
}

describe("passwordResetRefusal — who may reset whom", () => {
  it.each(["owner", "admin", "site", "client"] as const)("owner may reset another %s", (role) => {
    expect(passwordResetRefusal(OWNER, target({ id: "x", role }))).toBeNull();
  });

  it.each(["site", "client"] as const)("admin may reset a %s", (role) => {
    expect(passwordResetRefusal(ADMIN, target({ id: "x", role }))).toBeNull();
  });

  it("refuses admin → owner (privilege escalation)", () => {
    expect(passwordResetRefusal(ADMIN, target({ id: "d1", role: "owner" }))).toBe("forbidden_role");
  });

  it("refuses admin → another admin", () => {
    expect(passwordResetRefusal(ADMIN, target({ id: "d3", role: "admin" }))).toBe("forbidden_role");
  });

  it.each([OWNER, ADMIN])("refuses a reset of your own password ($role)", (actor) => {
    expect(passwordResetRefusal(actor, target({ id: actor.userId, role: actor.role }))).toBe("self");
  });

  it("refuses a target the RLS-scoped read did not return (another org, or no such user)", () => {
    expect(passwordResetRefusal(OWNER, null)).toBe("not_found");
  });

  it("refuses a soft-deleted target", () => {
    expect(passwordResetRefusal(OWNER, target({ deletedAt: "2026-09-01T00:00:00Z" }))).toBe("not_found");
  });

  it("refuses a deactivated target", () => {
    expect(passwordResetRefusal(OWNER, target({ isActive: false }))).toBe("inactive");
  });

  it("refuses a target with no email to sign in with", () => {
    expect(passwordResetRefusal(OWNER, target({ email: null }))).toBe("no_email");
  });

  it.each(["site", "client"] as const)("refuses a %s caller outright", (role) => {
    expect(passwordResetRefusal({ userId: "z", role }, target({ id: "d6", role: "client" }))).toBe(
      "forbidden_role"
    );
  });

  it("canResetPassword agrees with the refusal", () => {
    expect(canResetPassword(ADMIN, target())).toBe(true);
    expect(canResetPassword(ADMIN, target({ id: "d1", role: "owner" }))).toBe(false);
  });
});

describe("resetAccountPassword", () => {
  function fakeSteps(found: ResetTarget | null, overrides: Partial<ResetSteps> = {}) {
    const calls: string[] = [];
    const passwords: string[] = [];
    const steps: ResetSteps = {
      loadTarget: async (id) => {
        calls.push(`loadTarget ${id}`);
        return found;
      },
      recordReset: async (id) => {
        calls.push(`recordReset ${id}`);
      },
      setAuthPassword: async (id, password) => {
        calls.push(`setAuthPassword ${id}`);
        passwords.push(password);
      },
      ...overrides,
    };
    return { steps, calls, passwords };
  }

  it("audits, then sets a fresh generated password, and returns it once", async () => {
    const { steps, calls, passwords } = fakeSteps(target());
    const result = await resetAccountPassword(steps, ADMIN, "d5");
    expect(calls).toEqual(["loadTarget d5", "recordReset d5", "setAuthPassword d5"]);
    expect(passwords[0]).toHaveLength(GENERATED_PASSWORD_LENGTH);
    expect(result).toEqual({
      status: "reset",
      userId: "d5",
      username: "ravi",
      email: "ravi@beapex.in",
      password: passwords[0],
    });
  });

  it.each([
    ["admin → owner", ADMIN, target({ id: "d1", role: "owner", email: "hello@beapex.in" }), "forbidden_role"],
    [
      "admin → admin",
      ADMIN,
      target({ id: "d3", role: "admin", email: "prakash@beapex.in" }),
      "forbidden_role",
    ],
    ["self", ADMIN, target({ id: "d2", role: "admin", email: "suresh@beapex.in" }), "self"],
    ["other org / not found", OWNER, null, "not_found"],
    ["deleted", OWNER, target({ deletedAt: "2026-09-01T00:00:00Z" }), "not_found"],
    ["deactivated", OWNER, target({ isActive: false }), "inactive"],
  ] as const)(
    "refuses %s without auditing or touching the password",
    async (_label, actor, found, reason) => {
      const { steps, calls } = fakeSteps(found);
      expect(await resetAccountPassword(steps, actor, found?.id ?? "elsewhere")).toEqual({
        status: "refused",
        reason,
      });
      expect(calls).toEqual([`loadTarget ${found?.id ?? "elsewhere"}`]);
    }
  );

  it("does not change the password when the database refuses", async () => {
    const setAuthPassword = vi.fn();
    const { steps } = fakeSteps(target(), {
      recordReset: async () => {
        throw new Error("FORBIDDEN: an admin may reset only site and client users");
      },
      setAuthPassword,
    });
    await expect(resetAccountPassword(steps, ADMIN, "d5")).rejects.toThrow("FORBIDDEN");
    expect(setAuthPassword).not.toHaveBeenCalled();
  });

  it("never puts the password in the error or the audit call", async () => {
    let password = "";
    const recorded: unknown[] = [];
    const { steps } = fakeSteps(target(), {
      recordReset: async (...args) => {
        recorded.push(...args);
      },
      setAuthPassword: async (_id, pw) => {
        password = pw;
        throw new Error("setAuthPassword: weak_password: Password is known to be weak");
      },
    });
    const error = await resetAccountPassword(steps, OWNER, "d5").catch((e: unknown) => e);
    expect(password).toHaveLength(GENERATED_PASSWORD_LENGTH);
    expect(String(error)).not.toContain(password);
    expect(JSON.stringify(recorded)).not.toContain(password);
  });
});
