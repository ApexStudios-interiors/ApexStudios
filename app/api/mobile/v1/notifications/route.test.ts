import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: it guards with requireSession(), delegates to the
 * existing getNotifications(), and maps every failure to JSON with no-store —
 * never a redirect, never a raw database message. How a bearer token becomes a
 * session is lib/auth/session.test.ts's job.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireSession: vi.fn<() => Promise<Session>>(),
    getNotifications: vi.fn<(session: Session) => Promise<unknown[]>>(),
  };
});

vi.mock("server-only", () => ({}));
// Bearer-first (lib/mobile/api.ts): the route reads the header before the
// session; the token itself is verified by requireSession(), mocked below.
vi.mock("@/lib/supabase/server", () => ({
  getBearerToken: async () => h.bearerToken,
  createClient: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: h.requireSession,
  requireRole: vi.fn(),
}));
vi.mock("@/features/notifications/queries", () => ({ getNotifications: h.getNotifications }));

const { GET } = await import("./route");

const SESSION: Session = {
  userId: "00000000-0000-4000-8000-0000000000d1",
  orgId: "00000000-0000-4000-8000-0000000000a0",
  role: "client",
  fullName: "Client",
  email: null,
  impersonating: null,
};

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireSession.mockReset();
  h.getNotifications.mockReset();
});

describe("GET /api/mobile/v1/notifications", () => {
  it("returns the session's notifications as JSON, no-store", async () => {
    const items = [{ kind: "approval_pending", entityId: "e1", unread: true }];
    h.requireSession.mockResolvedValue(SESSION);
    h.getNotifications.mockResolvedValue(items);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ notifications: items });
    expect(h.getNotifications).toHaveBeenCalledWith(SESSION);
  });

  it("returns JSON 401 when there is no session", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await GET();

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Your session expired. Please sign in again.",
    });
    expect(h.getNotifications).not.toHaveBeenCalled();
  });

  it("returns JSON 403 on a forbidden error", async () => {
    h.requireSession.mockResolvedValue(SESSION);
    h.getNotifications.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: not a member"));

    const res = await GET();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "You don't have permission to do that.",
    });
  });

  it("returns JSON 500 with the mapped message, never the raw database error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.requireSession.mockResolvedValue(SESSION);
    h.getNotifications.mockRejectedValue(new Error('relation "v_notifications" does not exist'));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.error).toBe("INTERNAL");
    expect(body.message).toMatch(/^Something went wrong\. Reference: /);
    expect(JSON.stringify(body)).not.toContain("v_notifications");
    consoleError.mockRestore();
  });

  it("maps a prefixed Postgres domain error to its status and user-facing copy", async () => {
    h.requireSession.mockResolvedValue(SESSION);
    h.getNotifications.mockRejectedValue(new Error("RATE_LIMITED: slow down"));

    const res = await GET();

    // Mapped to its own status now, as on every newer mobile route.
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "RATE_LIMITED",
      message: "Too many requests. Please wait a moment and try again.",
    });
  });
});

describe("Bearer only (Batch 18)", () => {
  it("returns 401 { error, message } with no Authorization header, before the session or any query", async () => {
    h.bearerToken = null;

    const res = await GET();

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Your session expired. Please sign in again.",
    });
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.getNotifications).not.toHaveBeenCalled();
  });

  it("refuses a browser cookie session that carries no Bearer header — even one requireSession would accept", async () => {
    // A cookie session resolves in requireSession(); the route never asks.
    h.bearerToken = null;
    h.requireSession.mockResolvedValue({
      userId: "00000000-0000-4000-8000-0000000000d1",
      orgId: "00000000-0000-4000-8000-0000000000a0",
      role: "admin",
      fullName: "Cookie User",
      email: null,
      impersonating: null,
    });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.getNotifications).not.toHaveBeenCalled();
  });

  it("returns 401 { error, message } for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Your session expired. Please sign in again.",
    });
    expect(h.getNotifications).not.toHaveBeenCalled();
  });

  it("returns errors as exactly { error, message } — no stack, SQL or token", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.requireSession.mockRejectedValue(
      new Error("connection to 10.0.0.5 failed: password authentication failed")
    );

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(Object.keys(body).sort()).toEqual(["error", "message"]);
    expect(JSON.stringify(body)).not.toMatch(/10\.0\.0\.5|password|mobile-token|stack/i);
    consoleError.mockRestore();
  });
});
