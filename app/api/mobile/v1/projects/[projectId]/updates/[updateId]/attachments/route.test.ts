import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required, admin/site only, both ids
 * checked, project access checked, only the file's name/type/size taken from
 * the body — project, update and entity type always the server's — validated
 * by the web action's own requestUploadUrlSchema (real, not mocked), the
 * shared requestUploadFor called with the authenticated session, `{ url, key }`
 * returned, and errors mapped with mapDomainError's copy. The helper is
 * mocked — it is tested through the web action in
 * features/attachments/actions.test.ts.
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
    requestUploadFor: vi.fn(),
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
vi.mock("@/features/attachments/upload", () => ({ requestUploadFor: h.requestUploadFor }));

const { POST } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-0000000000c2";
const UPDATE_ID = "00000000-0000-4000-8000-0000000000b1";
const OTHER_UPDATE_ID = "00000000-0000-4000-8000-0000000000b2";
const SIGNED = {
  url: "https://r2.example/put?X-Amz-Signature=abc",
  key: `org/a0/project/${PROJECT_ID}/daily_update/${UPDATE_ID}/u-site.jpg`,
};

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

const FILE = { fileName: "site.jpg", mimeType: "image/jpeg", sizeBytes: 245_000 };

function call(body: unknown, projectId = PROJECT_ID, updateId = UPDATE_ID, raw?: string) {
  return POST(
    new Request(`http://localhost/api/mobile/v1/projects/${projectId}/updates/${updateId}/attachments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId, updateId }) }
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

function sentInput() {
  return h.requestUploadFor.mock.calls[0]?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireRole.mockReset();
  h.requireRole.mockResolvedValue(sessionAs("site"));
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.requestUploadFor.mockReset();
  h.requestUploadFor.mockResolvedValue(SIGNED);
});

describe("POST /api/mobile/v1/projects/:projectId/updates/:updateId/attachments", () => {
  it.each(["admin", "site"] as const)(
    "signs an upload for %s and returns { url, key } (200, no-store)",
    async (role) => {
      const session = sessionAs(role);
      h.requireRole.mockResolvedValue(session);

      const res = await call(FILE);

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual(SIGNED);
      expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["admin", "site"]);
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.requestUploadFor).toHaveBeenCalledExactlyOnceWith(session, {
        ...FILE,
        projectId: PROJECT_ID,
        entityType: "daily_update",
        entityId: UPDATE_ID,
      });
    }
  );

  it("never lets the body choose the entity type, project or update", async () => {
    await call({
      ...FILE,
      entityType: "approval",
      entityId: OTHER_UPDATE_ID,
      projectId: OTHER_PROJECT_ID,
    });

    expect(sentInput()).toEqual({
      ...FILE,
      projectId: PROJECT_ID,
      entityType: "daily_update",
      entityId: UPDATE_ID,
    });
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call(FILE);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.requestUploadFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call(FILE);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requestUploadFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, before anything is signed", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin, site"));

    const res = await call(FILE);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.requestUploadFor).not.toHaveBeenCalled();
  });

  it.each([
    ["project", "not-a-uuid", UPDATE_ID],
    ["update", PROJECT_ID, "not-a-uuid"],
  ])("returns 404 for a %s id that is not a uuid, before any project or storage work", async (_l, p, u) => {
    const res = await call(FILE, p, u);

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.requestUploadFor).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no access to the project", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await call(FILE);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requestUploadFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, PROJECT_ID, UPDATE_ID, "fileName=site.jpg");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
  });

  it("returns 400 for a body that is not an object", async () => {
    const res = await call([FILE]);

    await expectError(res, 400, "VALIDATION", "Request body must be a JSON object.");
  });

  it.each([
    ["a missing file name", { mimeType: "image/jpeg", sizeBytes: 1000 }],
    ["a blank file name", { ...FILE, fileName: "   " }],
    ["a type that is not allowed", { ...FILE, mimeType: "image/gif" }],
    ["a missing type", { fileName: "site.jpg", sizeBytes: 1000 }],
    ["a zero size", { ...FILE, sizeBytes: 0 }],
    ["a fractional size", { ...FILE, sizeBytes: 10.5 }],
  ])("returns 400 for %s, with the schema's own message", async (_label, body) => {
    const res = await call(body);

    await expectError(res, 400, "VALIDATION", /./);
    expect(h.requestUploadFor).not.toHaveBeenCalled();
  });

  it.each([
    [
      "REASON_REQUIRED: this daily_update already has 4 attachments",
      422,
      "REASON_REQUIRED",
      "Please give a reason.",
    ],
    ["REASON_REQUIRED: file exceeds the 10 MB limit", 422, "REASON_REQUIRED", "Please give a reason."],
    [
      "FORBIDDEN: only admin or site may add photos to a daily update",
      403,
      "FORBIDDEN",
      "You don't have permission to do that.",
    ],
  ] as const)("maps the helper's %s to its status and copy", async (message, status, code, copy) => {
    h.requestUploadFor.mockRejectedValue(new Error(message));

    const res = await call(FILE);

    await expectError(res, status, code, copy);
  });

  it("returns 500 with a reference for an unexpected error, never the raw message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.requestUploadFor.mockRejectedValue(new Error("R2 credentials rejected: AccessKeyId AKIA…"));

    const res = await call(FILE);

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
