import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * lib/mobile/api.ts — the mobile API's Bearer-first session and its error
 * shape. What it pins down: no Bearer header means 401 before the session is
 * even looked at (so a cookie never authorizes a mobile route); a header
 * hands verification to requireSession() unchanged; and every error is
 * `{ error, message }` with mapDomainError's copy, never internals.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireSession: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: h.requireSession,
  requireRole: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getBearerToken: async () => h.bearerToken,
  createClient: vi.fn(),
}));

const { requireBearerSession, mobileErrorFrom, mobileNotFound, mobileError } = await import("./api");

const SESSION: Session = {
  userId: "00000000-0000-4000-8000-0000000000d1",
  orgId: "00000000-0000-4000-8000-0000000000a0",
  role: "site",
  fullName: "Test User",
  email: null,
  impersonating: null,
};

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireSession.mockReset();
  h.requireSession.mockResolvedValue(SESSION);
});

describe("requireBearerSession", () => {
  it("returns requireSession()'s session when a Bearer header is present", async () => {
    await expect(requireBearerSession()).resolves.toBe(SESSION);
    expect(h.requireSession).toHaveBeenCalledOnce();
  });

  it("throws UnauthenticatedError with no Bearer header, without consulting the session (a cookie)", async () => {
    h.bearerToken = null;

    await expect(requireBearerSession()).rejects.toBeInstanceOf(h.UnauthenticatedError);
    expect(h.requireSession).not.toHaveBeenCalled();
  });

  it("passes requireSession()'s own rejection through — an invalid or expired token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    await expect(requireBearerSession()).rejects.toBeInstanceOf(h.UnauthenticatedError);
  });
});

describe("mobile error responses", () => {
  async function shape(res: Response) {
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["error", "message"]);
    return { status: res.status, body };
  }

  it.each([
    [
      new h.UnauthenticatedError("UNAUTHENTICATED"),
      401,
      "UNAUTHENTICATED",
      "Your session expired. Please sign in again.",
    ],
    [
      new h.ForbiddenError("FORBIDDEN: not a member"),
      403,
      "FORBIDDEN",
      "You don't have permission to do that.",
    ],
    [new Error("NOT_FOUND: project x does not exist"), 404, "NOT_FOUND", "That record no longer exists."],
    [
      new Error("ILLEGAL_TRANSITION: pending to pending"),
      409,
      "ILLEGAL_TRANSITION",
      "This request has already moved on. Refresh to see the current status.",
    ],
    [new Error("REASON_REQUIRED: a reason is required"), 422, "REASON_REQUIRED", "Please give a reason."],
    [
      new Error("RATE_LIMITED: slow down"),
      429,
      "RATE_LIMITED",
      "Too many requests. Please wait a moment and try again.",
    ],
  ] as const)("maps %s to %i with mapDomainError's copy", async (err, status, code, message) => {
    const { status: s, body } = await shape(mobileErrorFrom(err));

    expect(s).toBe(status);
    expect(body).toEqual({ error: code, message });
  });

  it("maps anything else to 500 with a reference — never the raw message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { status, body } = await shape(
      mobileErrorFrom(new Error('relation "secret_table" does not exist'))
    );

    expect(status).toBe(500);
    expect(body.error).toBe("INTERNAL");
    expect(body.message).toMatch(/^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toContain("secret_table");
    consoleError.mockRestore();
  });

  it("maps a thrown non-Error value to 500 as well", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { status } = await shape(mobileErrorFrom("boom"));

    expect(status).toBe(500);
    consoleError.mockRestore();
  });

  it("gives every not-found the same 404 copy", async () => {
    const { status, body } = await shape(mobileNotFound());

    expect(status).toBe(404);
    expect(body).toEqual({ error: "NOT_FOUND", message: "That record no longer exists." });
  });

  it("builds any explicit error the same way", async () => {
    const { status, body } = await shape(mobileError(400, "VALIDATION", "Request body must be valid JSON."));

    expect(status).toBe(400);
    expect(body).toEqual({ error: "VALIDATION", message: "Request body must be valid JSON." });
  });
});
