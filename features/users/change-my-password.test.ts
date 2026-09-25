import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * changeMyPasswordAction end to end through next-safe-action, with the session
 * and the user-scoped Supabase client faked.
 *
 * What it pins down: the current password is really verified (by
 * re-authenticating), every refusal happens BEFORE the password is changed,
 * and neither password ever appears in a result.
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
    /** The password the fake GoTrue will accept for signInWithPassword. */
    correctPassword: "current-password-1",
    signIn: vi.fn<(arg: { email: string; password: string }) => Promise<{ error: unknown }>>(),
    updateUser: vi.fn<(arg: { password: string }) => Promise<{ error: unknown }>>(async () => ({
      error: null,
    })),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: async () => {
    if (!h.session) throw new h.UnauthenticatedError();
    return h.session;
  },
  requireRole: async (roles: string[]) => {
    if (!roles.includes(h.session.role)) throw new h.ForbiddenError("role");
    return h.session;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword: h.signIn, updateUser: h.updateUser },
    from: () => ({}),
    rpc: vi.fn(),
  }),
}));
vi.mock("@/lib/auth/admin", () => ({
  createAuthUser: vi.fn(),
  deleteAuthUser: vi.fn(),
  setAuthPassword: vi.fn(),
  revokeUserSessions: vi.fn(),
  setAuthUserBanned: vi.fn(),
}));
vi.mock("@/features/projects/members", () => ({ insertProjectMember: vi.fn() }));

const { changeMyPasswordAction } = await import("./actions");

const ORG = "00000000-0000-4000-8000-0000000000a0";
const USER_ID = "00000000-0000-4000-8000-0000000000d1";
const CURRENT = "current-password-1";
const NEXT = "a-much-longer-new-one";

function sessionAs(role: Session["role"], email: string | null = "hello@beapex.in") {
  h.session = { userId: USER_ID, orgId: ORG, role, fullName: "x", email, impersonating: null };
}

beforeEach(() => {
  h.signIn.mockReset();
  h.signIn.mockImplementation(async ({ password }) =>
    password === h.correctPassword ? { error: null } : { error: { message: "invalid credentials" } }
  );
  h.updateUser.mockClear();
  sessionAs("owner");
});

describe("changeMyPasswordAction", () => {
  it.each([["owner"], ["admin"], ["site"], ["client"]] as const)(
    "lets %s change their own password after re-authenticating",
    async (role) => {
      sessionAs(role);
      const result = await changeMyPasswordAction({
        currentPassword: CURRENT,
        newPassword: NEXT,
        confirmPassword: NEXT,
      });

      expect(result.serverError).toBeUndefined();
      expect(result.data).toEqual({ status: "changed" });
      expect(h.signIn).toHaveBeenCalledWith({ email: "hello@beapex.in", password: CURRENT });
      expect(h.updateUser).toHaveBeenCalledWith({ password: NEXT });
    }
  );

  it("never returns either password", async () => {
    const result = await changeMyPasswordAction({
      currentPassword: CURRENT,
      newPassword: NEXT,
      confirmPassword: NEXT,
    });
    expect(JSON.stringify(result)).not.toContain(CURRENT);
    expect(JSON.stringify(result)).not.toContain(NEXT);
  });

  it("refuses a wrong current password, and changes nothing", async () => {
    const result = await changeMyPasswordAction({
      currentPassword: "not-my-password",
      newPassword: NEXT,
      confirmPassword: NEXT,
    });

    expect(result.data).toEqual({ status: "refused", reason: "wrong_password" });
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a new password shorter than the minimum, before reaching Auth", async () => {
    const result = await changeMyPasswordAction({
      currentPassword: CURRENT,
      newPassword: "short1",
      confirmPassword: "short1",
    });

    expect(result.validationErrors).toBeDefined();
    expect(h.signIn).not.toHaveBeenCalled();
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a new password identical to the current one", async () => {
    const result = await changeMyPasswordAction({
      currentPassword: CURRENT,
      newPassword: CURRENT,
      confirmPassword: CURRENT,
    });

    expect(result.validationErrors).toBeDefined();
    expect(h.signIn).not.toHaveBeenCalled();
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a confirmation that does not match", async () => {
    const result = await changeMyPasswordAction({
      currentPassword: CURRENT,
      newPassword: NEXT,
      confirmPassword: `${NEXT}x`,
    });

    expect(result.validationErrors).toBeDefined();
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("refuses an account with no email to re-authenticate against", async () => {
    sessionAs("client", null);
    const result = await changeMyPasswordAction({
      currentPassword: CURRENT,
      newPassword: NEXT,
      confirmPassword: NEXT,
    });

    expect(result.data).toEqual({ status: "refused", reason: "no_email" });
    expect(h.signIn).not.toHaveBeenCalled();
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("refuses a caller with no session", async () => {
    h.session = null as unknown as Session;
    const result = await changeMyPasswordAction({
      currentPassword: CURRENT,
      newPassword: NEXT,
      confirmPassword: NEXT,
    });

    expect(result.serverError).toBe("Your session expired. Please sign in again.");
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("does not leak GoTrue's message when the update fails", async () => {
    h.updateUser.mockResolvedValueOnce({ error: { code: "weak_password", message: "too weak" } });
    const result = await changeMyPasswordAction({
      currentPassword: CURRENT,
      newPassword: NEXT,
      confirmPassword: NEXT,
    });

    expect(result.serverError).toMatch(/^Something went wrong\. Reference: /);
  });
});
