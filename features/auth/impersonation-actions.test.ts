import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * startPreview's role gate (D20). Previewing as Admin is the OWNER's alone,
 * and the refusal is on the SERVER, against the REAL session role — the
 * sidebar not offering the entry is a courtesy, not the boundary.
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
    rpc: vi.fn<(name: string, args: unknown) => Promise<{ error: { message: string } | null }>>(async () => ({
      error: null,
    })),
    setCookie: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: h.setCookie, delete: vi.fn(), get: () => undefined }),
}));
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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: h.rpc }) }));
vi.mock("@/lib/auth/impersonation", () => ({
  PREVIEW_ROLES: ["client", "site", "admin"] as const,
  PREVIEW_COOKIE_NAME: "apex_preview",
  encodePreviewCookie: (role: string, projectId: string) => ({
    name: "apex_preview",
    value: `${role}.${projectId}`,
    maxAge: 900,
  }),
}));

const { startPreview } = await import("./impersonation-actions");

const ORG = "00000000-0000-4000-8000-0000000000a0";
const OWNER_ID = "00000000-0000-4000-8000-0000000000d1";
const ADMIN_ID = "00000000-0000-4000-8000-0000000000d2";
const PROJECT = "00000000-0000-4000-8000-0000000000c1";

function sessionAs(role: Session["role"], userId: string, impersonating: Session["impersonating"] = null) {
  h.session = { userId, orgId: ORG, role, fullName: "x", email: null, impersonating };
}

beforeEach(() => {
  h.rpc.mockClear();
  h.setCookie.mockClear();
});

describe("startPreview", () => {
  it("lets the owner preview as admin, and audits the previewed role (D20)", async () => {
    sessionAs("owner", OWNER_ID);
    const result = await startPreview({ role: "admin", projectId: PROJECT });

    expect(result.serverError).toBeUndefined();
    expect(result.data).toEqual({ ok: true });
    expect(h.rpc).toHaveBeenCalledWith("rpc_log_impersonation", {
      p_action: "start",
      p_previewed_role: "admin",
      p_project_ref: PROJECT,
    });
    expect(h.setCookie).toHaveBeenCalled();
  });

  it("refuses an admin previewing as admin, before the audit row or the cookie", async () => {
    sessionAs("admin", ADMIN_ID);
    const result = await startPreview({ role: "admin", projectId: PROJECT });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.setCookie).not.toHaveBeenCalled();
  });

  it("is not fooled by an admin already previewing as owner-ish reads", async () => {
    // The REAL role decides. An admin whose preview cookie says something else
    // is still an admin here.
    sessionAs("admin", ADMIN_ID, { role: "client", projectId: PROJECT });
    const result = await startPreview({ role: "admin", projectId: PROJECT });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([["site"], ["client"]] as const)("still lets an admin preview as %s", async (role) => {
    sessionAs("admin", ADMIN_ID);
    const result = await startPreview({ role, projectId: PROJECT });

    expect(result.data).toEqual({ ok: true });
    expect(h.rpc).toHaveBeenCalledWith("rpc_log_impersonation", {
      p_action: "start",
      p_previewed_role: role,
      p_project_ref: PROJECT,
    });
  });

  it("refuses a site or client caller at the guard", async () => {
    sessionAs("site", "00000000-0000-4000-8000-0000000000d5");
    const result = await startPreview({ role: "client", projectId: PROJECT });

    expect(result.serverError).toBe("You don't have permission to do that.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("rejects `owner` as a previewed role", async () => {
    sessionAs("owner", OWNER_ID);
    const result = await startPreview({ role: "owner" as "admin", projectId: PROJECT });

    expect(result.validationErrors).toBeDefined();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
