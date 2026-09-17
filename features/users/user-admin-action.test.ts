import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * setUserRole and setUserActive end to end through next-safe-action, with the
 * session, the RLS-scoped client and GoTrue faked. The rule itself is unit
 * tested in user-admin.test.ts and again in the database
 * (supabase/tests/13_user_role_and_deactivation_test.sql); this proves the
 * actions feed it the REAL session role (not the D20 preview role), and that a
 * refusal never reaches the RPC, the ban or the session revocation.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {
    constructor(detail?: string) {
      super(detail ? `FORBIDDEN: ${detail}` : "FORBIDDEN");
    }
  }
  return {
    UnauthenticatedError,
    ForbiddenError,
    session: null as unknown as Session,
    target: null as Record<string, unknown> | null,
    activeOwners: 1,
    rpc: vi.fn<(name: string, args: unknown) => Promise<{ error: { message: string } | null }>>(async () => ({
      error: null,
    })),
    revokeUserSessions: vi.fn<(userId: string) => Promise<number>>(async () => 1),
    setAuthUserBanned: vi.fn<(userId: string, banned: boolean) => Promise<void>>(async () => {}),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: async () => h.session,
  requireRole: async (roles: string[]) => {
    // Mirrors the real requireRole: the REAL role, never impersonating.
    if (!roles.includes(h.session.role)) throw new h.ForbiddenError("role");
    return h.session;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        maybeSingle: async () => ({ data: h.target, error: null }),
        // countActiveOwners awaits the builder itself (a head+count read).
        then: (resolve: (value: { count: number; error: null }) => void) =>
          resolve({ count: h.activeOwners, error: null }),
      };
      return query;
    },
    rpc: h.rpc,
  }),
}));
vi.mock("@/lib/auth/admin", () => ({
  createAuthUser: vi.fn(),
  deleteAuthUser: vi.fn(),
  setAuthPassword: vi.fn(),
  revokeUserSessions: h.revokeUserSessions,
  setAuthUserBanned: h.setAuthUserBanned,
}));
vi.mock("@/features/projects/members", () => ({ insertProjectMember: vi.fn() }));

const { setUserActive, setUserRole } = await import("./actions");

const ORG = "00000000-0000-4000-8000-0000000000a0";
const OWNER_ID = "00000000-0000-4000-8000-0000000000d1";
const ADMIN_ID = "00000000-0000-4000-8000-0000000000d2";
const OTHER_ADMIN_ID = "00000000-0000-4000-8000-0000000000d3";
const SITE_ID = "00000000-0000-4000-8000-0000000000d5";

function sessionAs(role: Session["role"], userId: string, impersonating: Session["impersonating"] = null) {
  h.session = { userId, orgId: ORG, role, fullName: "x", email: null, impersonating };
}

function profile(id: string, role: string, overrides: Record<string, unknown> = {}) {
  return { id, role, is_active: true, deleted_at: null, ...overrides };
}

const PREVIEW_AS_CLIENT = { role: "client" as const, projectId: "00000000-0000-4000-8000-0000000000c1" };

beforeEach(() => {
  h.rpc.mockClear();
  h.revokeUserSessions.mockClear();
  h.setAuthUserBanned.mockClear();
  h.activeOwners = 1;
});

describe("setUserRole", () => {
  it("owner previewing as client is still owner: may demote an admin, and ends their sessions", async () => {
    sessionAs("owner", OWNER_ID, PREVIEW_AS_CLIENT);
    h.target = profile(OTHER_ADMIN_ID, "admin");
    const result = await setUserRole({ userId: OTHER_ADMIN_ID, role: "site" });

    expect(result.serverError).toBeUndefined();
    expect(result.data).toEqual({ status: "changed", role: "site" });
    expect(h.rpc).toHaveBeenCalledWith("rpc_set_user_role", {
      p_target_id: OTHER_ADMIN_ID,
      p_role: "site",
    });
    expect(h.revokeUserSessions).toHaveBeenCalledWith(OTHER_ADMIN_ID);
    // A role change is not an account suspension.
    expect(h.setAuthUserBanned).not.toHaveBeenCalled();
  });

  it("refuses admin → owner before the RPC or the revocation", async () => {
    sessionAs("admin", ADMIN_ID, PREVIEW_AS_CLIENT);
    h.target = profile(OWNER_ID, "owner");
    h.activeOwners = 2;
    const result = await setUserRole({ userId: OWNER_ID, role: "site" });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.revokeUserSessions).not.toHaveBeenCalled();
  });

  it("refuses admin → admin", async () => {
    sessionAs("admin", ADMIN_ID);
    h.target = profile(OTHER_ADMIN_ID, "admin");
    const result = await setUserRole({ userId: OTHER_ADMIN_ID, role: "site" });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses changing your own role", async () => {
    sessionAs("admin", ADMIN_ID);
    h.target = profile(ADMIN_ID, "admin");
    const result = await setUserRole({ userId: ADMIN_ID, role: "site" });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses a user the RLS-scoped read cannot see (another org)", async () => {
    sessionAs("owner", OWNER_ID);
    h.target = null;
    const result = await setUserRole({ userId: SITE_ID, role: "admin" });

    expect(result.serverError).toBe("That record no longer exists.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses a soft-deleted user", async () => {
    sessionAs("owner", OWNER_ID);
    h.target = profile(SITE_ID, "site", { deleted_at: "2026-09-01T00:00:00Z" });
    const result = await setUserRole({ userId: SITE_ID, role: "admin" });

    expect(result.serverError).toBe("That record no longer exists.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses demoting the last active owner", async () => {
    sessionAs("owner", OWNER_ID);
    h.target = profile("00000000-0000-4000-8000-0000000000dd", "owner");
    h.activeOwners = 1;
    const result = await setUserRole({ userId: "00000000-0000-4000-8000-0000000000dd", role: "admin" });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses a site or client caller at the guard", async () => {
    sessionAs("site", SITE_ID);
    h.target = profile("00000000-0000-4000-8000-0000000000d6", "client");
    const result = await setUserRole({ userId: "00000000-0000-4000-8000-0000000000d6", role: "site" });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("rejects `owner` as a requested role before any of this runs", async () => {
    sessionAs("owner", OWNER_ID);
    h.target = profile(SITE_ID, "site");
    const result = await setUserRole({ userId: SITE_ID, role: "owner" as "admin" });

    expect(result.validationErrors).toBeDefined();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("leaves the session alone when the database refuses the change", async () => {
    sessionAs("admin", ADMIN_ID);
    h.target = profile(SITE_ID, "site");
    h.rpc.mockResolvedValueOnce({
      error: { message: "FORBIDDEN: an admin may act only on site and client users" },
    });
    const result = await setUserRole({ userId: SITE_ID, role: "client" });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.revokeUserSessions).not.toHaveBeenCalled();
  });
});

describe("setUserActive", () => {
  it("deactivates, bans the GoTrue account and ends every session", async () => {
    sessionAs("admin", ADMIN_ID);
    h.target = profile(SITE_ID, "site");
    const result = await setUserActive({ userId: SITE_ID, isActive: false });

    expect(result.data).toEqual({ status: "changed", isActive: false });
    expect(h.rpc).toHaveBeenCalledWith("rpc_set_user_active", { p_target_id: SITE_ID, p_active: false });
    expect(h.setAuthUserBanned).toHaveBeenCalledWith(SITE_ID, true);
    expect(h.revokeUserSessions).toHaveBeenCalledWith(SITE_ID);
  });

  it("reactivates by lifting the ban — deactivation is reversible", async () => {
    sessionAs("admin", ADMIN_ID);
    h.target = profile(SITE_ID, "site", { is_active: false });
    const result = await setUserActive({ userId: SITE_ID, isActive: true });

    expect(result.data).toEqual({ status: "changed", isActive: true });
    expect(h.setAuthUserBanned).toHaveBeenCalledWith(SITE_ID, false);
    expect(h.revokeUserSessions).not.toHaveBeenCalled();
  });

  it("refuses deactivating the owner as an admin, and bans nobody", async () => {
    sessionAs("admin", ADMIN_ID);
    h.target = profile(OWNER_ID, "owner");
    h.activeOwners = 2;
    const result = await setUserActive({ userId: OWNER_ID, isActive: false });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.setAuthUserBanned).not.toHaveBeenCalled();
    expect(h.revokeUserSessions).not.toHaveBeenCalled();
  });

  it("refuses deactivating yourself", async () => {
    sessionAs("owner", OWNER_ID);
    h.target = profile(OWNER_ID, "owner");
    h.activeOwners = 2;
    const result = await setUserActive({ userId: OWNER_ID, isActive: false });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses deactivating the last active owner", async () => {
    sessionAs("owner", OWNER_ID);
    h.target = profile("00000000-0000-4000-8000-0000000000dd", "owner");
    h.activeOwners = 1;
    const result = await setUserActive({ userId: "00000000-0000-4000-8000-0000000000dd", isActive: false });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses a no-op rather than banning and revoking for nothing", async () => {
    sessionAs("admin", ADMIN_ID);
    h.target = profile(SITE_ID, "site");
    const result = await setUserActive({ userId: SITE_ID, isActive: true });

    expect(result.serverError).toBe("This request has already moved on. Refresh to see the current status.");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.setAuthUserBanned).not.toHaveBeenCalled();
  });

  it("refuses a soft-deleted user", async () => {
    sessionAs("owner", OWNER_ID);
    h.target = profile(SITE_ID, "site", { deleted_at: "2026-09-01T00:00:00Z" });
    const result = await setUserActive({ userId: SITE_ID, isActive: false });

    expect(result.serverError).toBe("That record no longer exists.");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
