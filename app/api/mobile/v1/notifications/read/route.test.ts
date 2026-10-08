import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required (a cookie session alone never
 * authorizes it), any signed-in role, the notification identified by
 * `{ kind, entityId }` and validated by the web action's own
 * markNotificationReadSchema (real, not mocked), the shared
 * markNotificationReadFor called with the authenticated session — so whose
 * read state changes is always the caller's — `{ ok: true }` returned, no-store,
 * and errors mapped with mapDomainError's copy. The helper is mocked — it is
 * tested in features/notifications/read.test.ts.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireSession: vi.fn(),
    markNotificationReadFor: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: h.requireSession,
  requireRole: vi.fn(),
  requireProjectAccess: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getBearerToken: async () => h.bearerToken,
  createClient: vi.fn(),
}));
vi.mock("@/features/notifications/read", () => ({ markNotificationReadFor: h.markNotificationReadFor }));

const { POST } = await import("./route");

const ENTITY_ID = "00000000-0000-4000-8000-0000000000a9";
const OTHER_USER = "00000000-0000-4000-8000-0000000000d2";

function sessionAs(role: Session["role"]): Session {
  return {
    userId: "00000000-0000-4000-8000-0000000000d6",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating: null,
  };
}

const BODY = { kind: "approval_pending", entityId: ENTITY_ID };

function call(body: unknown, raw?: string) {
  return POST(
    new Request("http://localhost/api/mobile/v1/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    })
  );
}

async function expectError(res: Response, status: number, error: string, message: string | RegExp) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = await res.json();
  expect(body.error).toBe(error);
  if (typeof message === "string") expect(body.message).toBe(message);
  else expect(body.message).toMatch(message);
  expect(Object.keys(body).sort()).toEqual(["error", "message"]);
}

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireSession.mockReset();
  h.requireSession.mockResolvedValue(sessionAs("client"));
  h.markNotificationReadFor.mockReset();
  h.markNotificationReadFor.mockResolvedValue(undefined);
});

describe("POST /api/mobile/v1/notifications/read", () => {
  it("marks the notification read and returns exactly { ok: true } (200, no-store)", async () => {
    const res = await call(BODY);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
  });

  it.each(["admin", "site", "client"] as const)(
    "lets %s mark its own notification, with its own session",
    async (role) => {
      const session = sessionAs(role);
      h.requireSession.mockResolvedValue(session);

      const res = await call(BODY);

      expect(res.status).toBe(200);
      expect(h.markNotificationReadFor).toHaveBeenCalledExactlyOnceWith(session, {
        kind: "approval_pending",
        entityId: ENTITY_ID,
      });
    }
  );

  it.each(["stock_request", "bill_submitted", "approval_pending", "inventory_low"])(
    "accepts the notification kind %s",
    async (kind) => {
      const res = await call({ ...BODY, kind });

      expect(res.status).toBe(200);
    }
  );

  it("never lets the body say whose notification it is — the session's user is always the one marked", async () => {
    const session = sessionAs("site");
    h.requireSession.mockResolvedValue(session);

    await call({ ...BODY, profileId: OTHER_USER, userId: OTHER_USER });

    expect(h.markNotificationReadFor.mock.calls[0]?.[0]).toBe(session);
    expect(h.markNotificationReadFor.mock.calls[0]?.[1]).toEqual({
      kind: "approval_pending",
      entityId: ENTITY_ID,
    });
  });

  it("is safe to repeat for an already-read notification: the same call, 200 each time", async () => {
    const first = await call(BODY);
    const second = await call(BODY);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(h.markNotificationReadFor).toHaveBeenCalledTimes(2);
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call(BODY);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.markNotificationReadFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call(BODY);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.markNotificationReadFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, "kind=approval_pending");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
  });

  it("returns 400 for a body that is not an object", async () => {
    const res = await call([BODY]);

    await expectError(res, 400, "VALIDATION", "Request body must be a JSON object.");
  });

  it.each([
    ["an entity id that is not a uuid", { ...BODY, entityId: "AP-001" }],
    ["a missing entity id", { kind: "approval_pending" }],
    ["an unknown kind", { ...BODY, kind: "bill_paid" }],
    ["a missing kind", { entityId: ENTITY_ID }],
  ])("returns 400 for %s, with the schema's own message", async (_label, body) => {
    const res = await call(body);

    await expectError(res, 400, "VALIDATION", /./);
    expect(h.markNotificationReadFor).not.toHaveBeenCalled();
  });

  it("returns 500 with a reference for a database error, never the raw message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.markNotificationReadFor.mockRejectedValue(
      new Error('new row violates row-level security policy for table "notification_reads"')
    );

    const res = await call(BODY);

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    consoleError.mockRestore();
  });
});
