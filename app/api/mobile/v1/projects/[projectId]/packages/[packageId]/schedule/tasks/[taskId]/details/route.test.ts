import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * PATCH …/schedule/tasks/:taskId/details — Bearer first, admin/site (client
 * 403), project access, only the web form's editable fields read from the
 * body and checked by the web's updateTaskSchema (real), the URL's task id
 * authoritative, the shared updateTaskFor (mocked; tested in
 * features/schedule/tasks.test.ts) called with the URL's project and
 * package as its scope, `{ id }`, and errors through lib/mobile/api.ts.
 * Progress is not editable here.
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
    updateTaskFor: vi.fn(),
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
vi.mock("@/features/schedule/tasks", () => ({ updateTaskFor: h.updateTaskFor }));

const { PATCH } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";
const TASK_ID = "00000000-0000-4000-8000-000000000701";
const OTHER_ID = "00000000-0000-4000-8000-0000000000e9";

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

const SCOPE = { projectId: PROJECT_ID, packageId: PACKAGE_ID };

function call(
  body: unknown,
  ids: { projectId?: string; packageId?: string; taskId?: string } = {},
  raw?: string
) {
  const projectId = ids.projectId ?? PROJECT_ID;
  const packageId = ids.packageId ?? PACKAGE_ID;
  const taskId = ids.taskId ?? TASK_ID;
  return PATCH(
    new Request(
      `http://localhost/api/mobile/v1/projects/${projectId}/packages/${packageId}/schedule/tasks/${taskId}/details`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }
    ),
    { params: Promise.resolve({ projectId, packageId, taskId }) }
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
  h.updateTaskFor.mockReset();
  h.updateTaskFor.mockResolvedValue({ id: TASK_ID, projectId: PROJECT_ID });
});

describe("PATCH /api/mobile/v1/projects/:projectId/packages/:packageId/schedule/tasks/:taskId/details", () => {
  it.each(["admin", "site"] as const)(
    "edits for %s and returns { id } only (200, no-store)",
    async (role) => {
      const session = sessionAs(role);
      h.requireSession.mockResolvedValue(session);

      const res = await call({
        name: "Deshuttering",
        startDate: "2026-11-02",
        durationWeeks: 5,
        note: "Rain delay",
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ id: TASK_ID });
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.updateTaskFor).toHaveBeenCalledExactlyOnceWith(
        session,
        { id: TASK_ID, name: "Deshuttering", startDate: "2026-11-02", durationWeeks: 5, note: "Rain delay" },
        SCOPE
      );
    }
  );

  it("passes only the fields sent (a partial edit), trimmed and coerced by the web schema", async () => {
    await call({ note: "  done  ", durationWeeks: "2" });

    expect(h.updateTaskFor.mock.calls[0]?.[1]).toEqual({ id: TASK_ID, note: "done", durationWeeks: 2 });
  });

  it("lets a note be cleared (an empty note is a real edit, as on the web)", async () => {
    await call({ note: "" });

    expect(h.updateTaskFor.mock.calls[0]?.[1]).toEqual({ id: TASK_ID, note: "" });
  });

  it("uses the URL's task, project and package — ids and non-editable fields in the body are ignored", async () => {
    await call({
      name: "x",
      id: OTHER_ID,
      taskId: OTHER_ID,
      projectId: OTHER_ID,
      packageId: OTHER_ID,
      phaseId: OTHER_ID,
      ownerProfileId: OTHER_ID,
      progressPct: 100,
    });

    expect(h.updateTaskFor).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      { id: TASK_ID, name: "x" },
      SCOPE
    );
  });

  it("returns 400 when no editable field is sent — progress alone included", async () => {
    await expectError(await call({ progressPct: 50 }), 400, "VALIDATION", "Nothing to update.");
    await expectError(await call({}), 400, "VALIDATION", "Nothing to update.");
    expect(h.updateTaskFor).not.toHaveBeenCalled();
  });

  it.each([
    ["a blank name", { name: "  " }],
    ["a malformed start date", { startDate: "02/11/2026" }],
    ["zero weeks", { durationWeeks: 0 }],
    ["105 weeks", { durationWeeks: 105 }],
    ["a non-string note", { note: 5 }],
  ])("returns 400 for %s, before any write", async (_label, body) => {
    const res = await call(body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("VALIDATION");
    expect(h.updateTaskFor).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{nope", "Request body must be valid JSON."],
    ["not an object", "[]", "Request body must be a JSON object."],
  ])("returns 400 for %s", async (_label, raw, message) => {
    await expectError(await call(null, {}, raw), 400, "VALIDATION", message);
    expect(h.updateTaskFor).not.toHaveBeenCalled();
  });

  it("returns 401 with no Bearer header, before the session is read", async () => {
    h.bearerToken = null;

    await expectError(
      await call({ name: "x" }),
      401,
      "UNAUTHENTICATED",
      "Your session expired. Please sign in again."
    );
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.updateTaskFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    await expectError(
      await call({ name: "x" }),
      401,
      "UNAUTHENTICATED",
      "Your session expired. Please sign in again."
    );
    expect(h.updateTaskFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, before any project check or write", async () => {
    h.requireSession.mockResolvedValue(sessionAs("client"));

    await expectError(await call({ name: "x" }), 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.updateTaskFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a project the user cannot access, before any write", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    await expectError(await call({ name: "x" }), 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.updateTaskFor).not.toHaveBeenCalled();
  });

  it.each([
    ["project", { projectId: "nope" }],
    ["package", { packageId: "nope" }],
    ["task", { taskId: "nope" }],
  ])("returns 404 for a malformed %s id, before any access check or write", async (_label, ids) => {
    await expectError(await call({ name: "x" }, ids), 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.updateTaskFor).not.toHaveBeenCalled();
  });

  it("returns 404 for a task of another package or project (the helper's scope check)", async () => {
    h.updateTaskFor.mockRejectedValue(new Error("NOT_FOUND: this task does not belong to this package"));

    await expectError(await call({ name: "x" }), 404, "NOT_FOUND", "That record no longer exists.");
  });

  it("returns 404 for a deleted task", async () => {
    h.updateTaskFor.mockRejectedValue(new Error("NOT_FOUND: this task no longer exists"));

    await expectError(await call({ name: "x" }), 404, "NOT_FOUND", "That record no longer exists.");
  });

  it("returns 500 with a reference for an unexpected error, never the raw message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.updateTaskFor.mockRejectedValue(new Error('new row for relation "tasks" violates check constraint'));

    await expectError(
      await call({ name: "x" }),
      500,
      "INTERNAL",
      /^Something went wrong\. Reference: [0-9a-f-]{36}$/
    );
    consoleError.mockRestore();
  });
});
