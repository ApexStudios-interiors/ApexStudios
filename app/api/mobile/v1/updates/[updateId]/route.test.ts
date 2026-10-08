import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required, admin/site only, the update id
 * checked, only `body` accepted and validated by the web action's own
 * editDailyUpdateSchema (real, not mocked), the shared editDailyUpdateFor
 * called with the authenticated session, and errors mapped to statuses with
 * mapDomainError's copy — a refused edit (not the author, or past 24 hours)
 * is the helper's ILLEGAL_TRANSITION, 409. The helper is mocked — it is
 * tested in features/updates/write.test.ts, the database rules against
 * Postgres in tests/integration/files-and-jobs.test.ts.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireRole: vi.fn(),
    editDailyUpdateFor: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireRole: h.requireRole,
  requireProjectAccess: vi.fn(),
  requireSession: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getBearerToken: async () => h.bearerToken,
  createClient: vi.fn(),
}));
vi.mock("@/features/updates/write", () => ({ editDailyUpdateFor: h.editDailyUpdateFor }));

const { PATCH } = await import("./route");

const UPDATE_ID = "00000000-0000-4000-8000-0000000000b1";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

function sessionAs(role: Session["role"]): Session {
  return {
    userId: "00000000-0000-4000-8000-0000000000d5",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating: null,
  };
}

function call(body: unknown, updateId = UPDATE_ID, raw?: string) {
  return PATCH(
    new Request(`http://localhost/api/mobile/v1/updates/${updateId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ updateId }) }
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
  h.requireRole.mockReset();
  h.requireRole.mockResolvedValue(sessionAs("site"));
  h.editDailyUpdateFor.mockReset();
  h.editDailyUpdateFor.mockResolvedValue({ id: UPDATE_ID, projectId: PROJECT_ID });
});

describe("PATCH /api/mobile/v1/updates/:updateId", () => {
  it("edits the body and returns { id } (200, no-store)", async () => {
    const res = await call({ body: "Coat two, not one" });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: UPDATE_ID });
  });

  it.each(["admin", "site"] as const)(
    "lets %s through, calling the shared helper with that session and { id, body } only",
    async (role) => {
      const session = sessionAs(role);
      h.requireRole.mockResolvedValue(session);

      const res = await call({ body: "  Coat two, not one  " });

      expect(res.status).toBe(200);
      expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["admin", "site"]);
      expect(h.editDailyUpdateFor).toHaveBeenCalledExactlyOnceWith(session, {
        id: UPDATE_ID,
        body: "Coat two, not one",
      });
    }
  );

  it.each([
    ["packageId", { body: "x", packageId: "00000000-0000-4000-8000-0000000000e7" }],
    ["projectId", { body: "x", projectId: "00000000-0000-4000-8000-0000000000c2" }],
    ["updateDate", { body: "x", updateDate: "2026-01-01" }],
    ["authorId", { body: "x", authorId: "00000000-0000-4000-8000-0000000000d2" }],
    ["id", { body: "x", id: "00000000-0000-4000-8000-0000000000b2" }],
  ])("refuses a body carrying %s (400) — only the text can be edited", async (_label, body) => {
    const res = await call(body);

    await expectError(res, 400, "VALIDATION", "Only the update's text can be edited.");
    expect(h.editDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call({ body: "x" });

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.editDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call({ body: "x" });

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.editDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, before any database work", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin, site"));

    const res = await call({ body: "x" });

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.editDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("returns 404 for an update id that is not a uuid, before any database work", async () => {
    const res = await call({ body: "x" }, "not-a-uuid");

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.editDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, UPDATE_ID, "body=x");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
  });

  it("returns 400 for a body that is not an object", async () => {
    const res = await call(["x"]);

    await expectError(res, 400, "VALIDATION", "Request body must be a JSON object.");
  });

  it.each([
    ["a blank body", { body: "   " }],
    ["a missing body", {}],
    ["a body that is not text", { body: 42 }],
  ])("returns 400 for %s, with the schema's own message", async (_label, body) => {
    const res = await call(body);

    await expectError(res, 400, "VALIDATION", /./);
    expect(h.editDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("returns 409 when the edit is refused (not the author, or past 24 hours), with the web's copy", async () => {
    h.editDailyUpdateFor.mockRejectedValue(
      new Error("ILLEGAL_TRANSITION: this update can no longer be edited")
    );

    const res = await call({ body: "Too late" });

    await expectError(
      res,
      409,
      "ILLEGAL_TRANSITION",
      "This request has already moved on. Refresh to see the current status."
    );
  });

  it("maps a database FORBIDDEN refusal to 403", async () => {
    h.editDailyUpdateFor.mockRejectedValue(
      new Error("FORBIDDEN: only the body of a daily update can be edited")
    );

    const res = await call({ body: "x" });

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
  });

  it("returns 500 with a reference for an unexpected error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.editDailyUpdateFor.mockRejectedValue(new Error('relation "daily_updates" does not exist'));

    const res = await call({ body: "x" });

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
