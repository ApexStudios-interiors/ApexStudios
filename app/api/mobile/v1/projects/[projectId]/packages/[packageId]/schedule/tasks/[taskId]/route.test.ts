import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required (a cookie session alone never
 * authorizes it), admin/site only, all three ids checked, project access
 * checked, only `progressPct` taken from the body and validated by the web
 * action's own setTaskProgressSchema (real, not mocked: a whole number
 * 0–100), the shared setTaskProgressFor called with the session and the
 * URL's project and package as scope, `{ id, progressPct }` returned,
 * no-store, and errors mapped with mapDomainError's copy. The helper is
 * mocked — it is tested in features/schedule/progress.test.ts.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireRole: vi.fn(),
    requireProjectAccess: vi.fn(),
    setTaskProgressFor: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireRole: h.requireRole,
  requireProjectAccess: h.requireProjectAccess,
  requireSession: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getBearerToken: async () => h.bearerToken,
  createClient: vi.fn(),
}));
vi.mock("@/features/schedule/progress", () => ({ setTaskProgressFor: h.setTaskProgressFor }));

const { PATCH } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";
const TASK_ID = "00000000-0000-4000-8000-000000000701";

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

function call(
  body: unknown,
  ids: Partial<{ projectId: string; packageId: string; taskId: string }> = {},
  raw?: string
) {
  const projectId = ids.projectId ?? PROJECT_ID;
  const packageId = ids.packageId ?? PACKAGE_ID;
  const taskId = ids.taskId ?? TASK_ID;
  return PATCH(
    new Request(
      `http://localhost/api/mobile/v1/projects/${projectId}/packages/${packageId}/schedule/tasks/${taskId}`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }
    ),
    { params: Promise.resolve({ projectId, packageId, taskId }) }
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
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.setTaskProgressFor.mockReset();
  h.setTaskProgressFor.mockImplementation(
    async (_s: Session, input: { id: string; progressPct: number }) => ({
      id: input.id,
      progressPct: input.progressPct,
      projectId: PROJECT_ID,
      packageId: PACKAGE_ID,
    })
  );
});

describe("PATCH /api/mobile/v1/projects/:projectId/packages/:packageId/schedule/tasks/:taskId", () => {
  it("sets the progress and returns exactly { id, progressPct } (200, no-store)", async () => {
    const res = await call({ progressPct: 60 });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: TASK_ID, progressPct: 60 });
  });

  it.each(["admin", "site"] as const)(
    "lets %s set an accessible task's progress, scoped to the URL's project and package",
    async (role) => {
      const session = sessionAs(role);
      h.requireRole.mockResolvedValue(session);

      const res = await call({ progressPct: 40 });

      expect(res.status).toBe(200);
      expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["admin", "site"]);
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.setTaskProgressFor).toHaveBeenCalledExactlyOnceWith(
        session,
        { id: TASK_ID, progressPct: 40 },
        { projectId: PROJECT_ID, packageId: PACKAGE_ID }
      );
    }
  );

  it.each([0, 100, 1, 99])("accepts the boundary value %i", async (pct) => {
    const res = await call({ progressPct: pct });

    expect(res.status).toBe(200);
    expect(h.setTaskProgressFor.mock.calls[0]?.[1]).toEqual({ id: TASK_ID, progressPct: pct });
  });

  it('accepts a numeric string ("75"), as the web schema coerces', async () => {
    await call({ progressPct: "75" });

    expect(h.setTaskProgressFor.mock.calls[0]?.[1]).toEqual({ id: TASK_ID, progressPct: 75 });
  });

  it.each([
    ["below 0", -1],
    ["above 100", 101],
    ["a fraction", 50.5],
    ["not a number", "half"],
    ["missing", undefined],
  ])("returns 400 for a progress %s, writing nothing", async (_label, progressPct) => {
    const res = await call({ progressPct });

    await expectError(res, 400, "VALIDATION", /./);
    expect(h.setTaskProgressFor).not.toHaveBeenCalled();
  });

  it("ignores everything in the body but progressPct — the task, package and project are the URL's", async () => {
    await call({
      progressPct: 30,
      id: "00000000-0000-4000-8000-000000000702",
      projectId: "00000000-0000-4000-8000-0000000000c2",
      packageId: "00000000-0000-4000-8000-0000000000e2",
      role: "admin",
    });

    expect(h.setTaskProgressFor).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      { id: TASK_ID, progressPct: 30 },
      { projectId: PROJECT_ID, packageId: PACKAGE_ID }
    );
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call({ progressPct: 50 });

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.setTaskProgressFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call({ progressPct: 50 });

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.setTaskProgressFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, before anything is read or written", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin, site"));

    const res = await call({ progressPct: 50 });

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.setTaskProgressFor).not.toHaveBeenCalled();
  });

  it.each([
    ["project", { projectId: "not-a-uuid" }],
    ["package", { packageId: "pool" }],
    ["task", { taskId: "T-1" }],
  ])("returns 404 for a %s id that is not a uuid, before anything is read", async (_label, ids) => {
    const res = await call({ progressPct: 50 }, ids);

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.setTaskProgressFor).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no access to the project", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await call({ progressPct: 50 });

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.setTaskProgressFor).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a task of another package or project",
      "NOT_FOUND: this task does not belong to this package",
      404,
      "NOT_FOUND",
    ],
    [
      "a task that no longer exists or cannot be seen",
      "NOT_FOUND: this task no longer exists",
      404,
      "NOT_FOUND",
    ],
    [
      "the RPC's membership/role refusal",
      "FORBIDDEN: rpc_set_task_progress requires project membership and admin/site",
      403,
      "FORBIDDEN",
    ],
    ["the RPC's range check", "REASON_REQUIRED: progress must be between 0 and 100", 422, "REASON_REQUIRED"],
  ] as const)("maps %s", async (_label, message, status, code) => {
    h.setTaskProgressFor.mockRejectedValue(new Error(message));

    const res = await call({ progressPct: 50 });

    await expectError(res, status, code, /./);
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, {}, "progressPct=50");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
  });

  it("returns 400 for a body that is not an object", async () => {
    const res = await call([50]);

    await expectError(res, 400, "VALIDATION", "Request body must be a JSON object.");
  });

  it("returns 500 with a reference for an unexpected error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.setTaskProgressFor.mockRejectedValue(new Error('relation "tasks" does not exist'));

    const res = await call({ progressPct: 50 });

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    consoleError.mockRestore();
  });
});
