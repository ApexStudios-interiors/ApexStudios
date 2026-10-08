import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * POST …/projects/:projectId/packages/:packageId/schedule/tasks — Bearer
 * first, admin/site (client 403), project access, the web's createTaskSchema
 * (real), the shared createTaskFor (mocked; tested in
 * features/schedule/tasks.test.ts) called with the session, the parsed
 * fields and the URL's project and package as its scope, `{ id }` (201), and
 * errors through lib/mobile/api.ts.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireSession: vi.fn(),
    requireProjectAccess: vi.fn(),
    createTaskFor: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getBearerToken: async () => h.bearerToken,
  createClient: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: h.requireSession,
  requireProjectAccess: h.requireProjectAccess,
  requireRole: vi.fn(),
}));
vi.mock("@/features/schedule/tasks", () => ({ createTaskFor: h.createTaskFor }));

const { POST } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";
const OTHER_ID = "00000000-0000-4000-8000-0000000000e9";
const PHASE_ID = "00000000-0000-4000-8000-0000000000f1";
const OWNER_ID = "00000000-0000-4000-8000-0000000000d7";
const TASK_ID = "00000000-0000-4000-8000-000000000701";

function sessionAs(role: Session["role"]): Session {
  return {
    userId: "00000000-0000-4000-8000-0000000000d1",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating: null,
  };
}

const BODY = {
  phaseId: PHASE_ID,
  name: "Shuttering",
  ownerProfileId: OWNER_ID,
  startDate: "2026-10-12",
  durationWeeks: 3,
};

function call(body: unknown, projectId = PROJECT_ID, packageId = PACKAGE_ID, raw?: string) {
  return POST(
    new Request(`http://localhost/api/mobile/v1/projects/${projectId}/packages/${packageId}/schedule/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId, packageId }) }
  );
}

async function expectError(res: Response, status: number, error: string, message: string | RegExp) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(["error", "message"]);
  expect(body.error).toBe(error);
  if (typeof message === "string") expect(body.message).toBe(message);
  else expect(body.message).toMatch(message);
}

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireSession.mockReset();
  h.requireSession.mockResolvedValue(sessionAs("site"));
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.createTaskFor.mockReset();
  h.createTaskFor.mockResolvedValue({ id: TASK_ID, projectId: PROJECT_ID, packageId: PACKAGE_ID });
});

describe("POST /api/mobile/v1/projects/:projectId/packages/:packageId/schedule/tasks", () => {
  it.each(["admin", "site"] as const)(
    "creates for %s and returns { id } only (201, no-store)",
    async (role) => {
      const session = sessionAs(role);
      h.requireSession.mockResolvedValue(session);

      const res = await call(BODY);

      expect(res.status).toBe(201);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ id: TASK_ID });
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.createTaskFor).toHaveBeenCalledExactlyOnceWith(session, BODY, {
        projectId: PROJECT_ID,
        packageId: PACKAGE_ID,
      });
    }
  );

  it("applies the web schema's own transforms: trimmed name, no owner for an empty one, weeks coerced", async () => {
    await call({ ...BODY, name: "  Shuttering  ", ownerProfileId: "", durationWeeks: "4" });

    expect(h.createTaskFor.mock.calls[0]?.[1]).toEqual({
      phaseId: PHASE_ID,
      name: "Shuttering",
      ownerProfileId: undefined,
      startDate: "2026-10-12",
      durationWeeks: 4,
    });
  });

  it("takes the project and package from the URL — body ids are dropped, never passed on", async () => {
    await call({ ...BODY, projectId: OTHER_ID, packageId: OTHER_ID, id: OTHER_ID, progressPct: 80 });

    expect(h.createTaskFor.mock.calls[0]?.[1]).toEqual(BODY);
    expect(h.createTaskFor.mock.calls[0]?.[2]).toEqual({ projectId: PROJECT_ID, packageId: PACKAGE_ID });
  });

  it.each([
    ["no phase", { ...BODY, phaseId: undefined }],
    ["a malformed phase id", { ...BODY, phaseId: "nope" }],
    ["a blank name", { ...BODY, name: "   " }],
    ["a malformed owner id", { ...BODY, ownerProfileId: "nope" }],
    ["a malformed start date", { ...BODY, startDate: "12/10/2026" }],
    ["an impossible start date", { ...BODY, startDate: "2026-02-30" }],
    ["zero weeks", { ...BODY, durationWeeks: 0 }],
    ["105 weeks", { ...BODY, durationWeeks: 105 }],
    ["fractional weeks", { ...BODY, durationWeeks: 1.5 }],
  ])("returns 400 for %s, before any write", async (_label, body) => {
    const res = await call(body);

    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(["error", "message"]);
    expect(json.error).toBe("VALIDATION");
    expect(h.createTaskFor).not.toHaveBeenCalled();
  });

  it("returns the web schema's own message for a blank name", async () => {
    await expectError(await call({ ...BODY, name: "" }), 400, "VALIDATION", "Name is required");
  });

  it.each([
    ["invalid JSON", "{nope", "Request body must be valid JSON."],
    ["not an object", "[]", "Request body must be a JSON object."],
  ])("returns 400 for %s", async (_label, raw, message) => {
    await expectError(await call(null, PROJECT_ID, PACKAGE_ID, raw), 400, "VALIDATION", message);
    expect(h.createTaskFor).not.toHaveBeenCalled();
  });

  it("returns 401 with no Bearer header, before the session is read", async () => {
    h.bearerToken = null;

    await expectError(
      await call(BODY),
      401,
      "UNAUTHENTICATED",
      "Your session expired. Please sign in again."
    );
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.createTaskFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    await expectError(
      await call(BODY),
      401,
      "UNAUTHENTICATED",
      "Your session expired. Please sign in again."
    );
    expect(h.createTaskFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, before any project check or write", async () => {
    h.requireSession.mockResolvedValue(sessionAs("client"));

    await expectError(await call(BODY), 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.createTaskFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a project the user cannot access, before any write", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    await expectError(await call(BODY), 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.createTaskFor).not.toHaveBeenCalled();
  });

  it.each([
    ["project", "not-a-uuid", PACKAGE_ID],
    ["package", PROJECT_ID, "not-a-uuid"],
  ])(
    "returns 404 for a malformed %s id, before any access check or write",
    async (_label, projectId, packageId) => {
      await expectError(
        await call(BODY, projectId, packageId),
        404,
        "NOT_FOUND",
        "That record no longer exists."
      );
      expect(h.requireProjectAccess).not.toHaveBeenCalled();
      expect(h.createTaskFor).not.toHaveBeenCalled();
    }
  );

  it("returns 404 for a phase of another package or project (the helper's scope check)", async () => {
    h.createTaskFor.mockRejectedValue(new Error("NOT_FOUND: that phase does not belong to this package"));

    await expectError(await call(BODY), 404, "NOT_FOUND", "That record no longer exists.");
  });

  it("returns 403 for the database's own role/membership refusal", async () => {
    h.createTaskFor.mockRejectedValue(new Error("FORBIDDEN: not allowed"));

    await expectError(await call(BODY), 403, "FORBIDDEN", "You don't have permission to do that.");
  });

  it("returns 500 with a reference for an unexpected error, never the raw message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.createTaskFor.mockRejectedValue(
      new Error(
        'insert or update on table "tasks" violates foreign key constraint "tasks_owner_profile_id_fkey"'
      )
    );

    const res = await call(BODY);

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    consoleError.mockRestore();
  });
});
