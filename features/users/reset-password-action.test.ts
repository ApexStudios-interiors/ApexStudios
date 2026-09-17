import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * resetUserPassword end to end through next-safe-action, with the session,
 * the RLS-scoped client and GoTrue faked. The rule itself is unit-tested in
 * service.test.ts; this proves the action feeds it the REAL session role (not
 * the D20 preview role) and that a refusal never reaches the database write
 * or GoTrue.
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
    rpc: vi.fn<(name: string, args: unknown) => Promise<{ error: { message: string } | null }>>(async () => ({
      error: null,
    })),
    setAuthPassword: vi.fn<(userId: string, password: string) => Promise<void>>(async () => {}),
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
        maybeSingle: async () => ({ data: h.target, error: null }),
      };
      return query;
    },
    rpc: h.rpc,
  }),
}));
vi.mock("@/lib/auth/admin", () => ({
  createAuthUser: vi.fn(),
  deleteAuthUser: vi.fn(),
  setAuthPassword: h.setAuthPassword,
}));
vi.mock("@/features/projects/members", () => ({ insertProjectMember: vi.fn() }));

const { resetUserPassword } = await import("./actions");

const ORG = "00000000-0000-4000-8000-0000000000a0";
const OWNER_ID = "00000000-0000-4000-8000-0000000000d1";
const ADMIN_ID = "00000000-0000-4000-8000-0000000000d2";
const OTHER_ADMIN_ID = "00000000-0000-4000-8000-0000000000d3";
const SITE_ID = "00000000-0000-4000-8000-0000000000d5";

function sessionAs(role: Session["role"], userId: string, impersonating: Session["impersonating"] = null) {
  h.session = { userId, orgId: ORG, role, fullName: "x", email: null, impersonating };
}

function profile(id: string, role: string, overrides: Record<string, unknown> = {}) {
  return { id, role, is_active: true, deleted_at: null, email: `${id.slice(-2)}@beapex.in`, ...overrides };
}

const PREVIEW_AS_CLIENT = { role: "client" as const, projectId: "00000000-0000-4000-8000-0000000000c1" };

beforeEach(() => {
  h.rpc.mockClear();
  h.setAuthPassword.mockClear();
});

describe("resetUserPassword", () => {
  it("owner previewing as client is still owner: may reset an admin", async () => {
    sessionAs("owner", OWNER_ID, PREVIEW_AS_CLIENT);
    h.target = profile(ADMIN_ID, "admin");
    const result = await resetUserPassword({ userId: ADMIN_ID });

    expect(result.serverError).toBeUndefined();
    expect(result.data).toMatchObject({ status: "reset", username: "d2", email: "d2@beapex.in" });
    expect(h.rpc).toHaveBeenCalledWith("rpc_record_password_reset", { p_target_id: ADMIN_ID });
    const [userId, password] = h.setAuthPassword.mock.calls[0] ?? [];
    expect(userId).toBe(ADMIN_ID);
    expect(result.data?.password).toBe(password);
  });

  it("refuses admin → owner before the audit call or GoTrue", async () => {
    sessionAs("admin", ADMIN_ID, PREVIEW_AS_CLIENT);
    h.target = profile(OWNER_ID, "owner");
    const result = await resetUserPassword({ userId: OWNER_ID });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(result.data).toBeUndefined();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.setAuthPassword).not.toHaveBeenCalled();
  });

  it("refuses admin → admin", async () => {
    sessionAs("admin", ADMIN_ID);
    h.target = profile(OTHER_ADMIN_ID, "admin");
    const result = await resetUserPassword({ userId: OTHER_ADMIN_ID });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.setAuthPassword).not.toHaveBeenCalled();
  });

  it("refuses self", async () => {
    sessionAs("owner", OWNER_ID);
    h.target = profile(OWNER_ID, "owner");
    const result = await resetUserPassword({ userId: OWNER_ID });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.setAuthPassword).not.toHaveBeenCalled();
  });

  it("refuses a user the RLS-scoped read cannot see (another org)", async () => {
    sessionAs("owner", OWNER_ID);
    h.target = null;
    const result = await resetUserPassword({ userId: SITE_ID });

    expect(result.serverError).toBe("That record no longer exists.");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.setAuthPassword).not.toHaveBeenCalled();
  });

  it("refuses a soft-deleted user", async () => {
    sessionAs("owner", OWNER_ID);
    h.target = profile(SITE_ID, "site", { deleted_at: "2026-09-01T00:00:00Z" });
    const result = await resetUserPassword({ userId: SITE_ID });

    expect(result.serverError).toBe("That record no longer exists.");
    expect(h.setAuthPassword).not.toHaveBeenCalled();
  });

  it("refuses a deactivated user", async () => {
    sessionAs("owner", OWNER_ID);
    h.target = profile(SITE_ID, "site", { is_active: false });
    const result = await resetUserPassword({ userId: SITE_ID });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.setAuthPassword).not.toHaveBeenCalled();
  });

  it("refuses a site or client caller at the guard, even with a target it could see", async () => {
    sessionAs("site", SITE_ID);
    h.target = profile("00000000-0000-4000-8000-0000000000d6", "client");
    const result = await resetUserPassword({ userId: "00000000-0000-4000-8000-0000000000d6" });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.setAuthPassword).not.toHaveBeenCalled();
  });

  it("changes nothing when the database refuses", async () => {
    sessionAs("admin", ADMIN_ID);
    h.target = profile(SITE_ID, "site");
    h.rpc.mockResolvedValueOnce({
      error: { message: "FORBIDDEN: an admin may reset only site and client users" },
    });
    const result = await resetUserPassword({ userId: SITE_ID });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.setAuthPassword).not.toHaveBeenCalled();
  });
});
