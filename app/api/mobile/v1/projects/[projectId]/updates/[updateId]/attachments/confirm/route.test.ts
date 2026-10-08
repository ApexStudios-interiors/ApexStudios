import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required, admin/site only, both ids
 * checked, project access checked, only the key and the file's name/type/size
 * taken from the body — project, update and entity type always the server's
 * — validated by the web action's own confirmUploadSchema (real, not
 * mocked), the shared confirmUploadFor called with the authenticated session,
 * `{ id }` returned (201), and the helper's and the database's refusals
 * mapped with mapDomainError's copy. The helper is mocked — it is tested
 * through the web action in features/attachments/actions.test.ts, the
 * database rules against Postgres in tests/integration/files-and-jobs.test.ts.
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
    confirmUploadFor: vi.fn(),
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
vi.mock("@/features/attachments/upload", () => ({ confirmUploadFor: h.confirmUploadFor }));

const { POST } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-0000000000c2";
const UPDATE_ID = "00000000-0000-4000-8000-0000000000b1";
const OTHER_UPDATE_ID = "00000000-0000-4000-8000-0000000000b2";
const ATTACHMENT_ID = "00000000-0000-4000-8000-000000000a01";

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

const UPLOADED = {
  key: `org/00000000-0000-4000-8000-0000000000a0/project/${PROJECT_ID}/daily_update/${UPDATE_ID}/u-site.jpg`,
  fileName: "site.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 245_000,
};

function call(body: unknown, projectId = PROJECT_ID, updateId = UPDATE_ID, raw?: string) {
  return POST(
    new Request(
      `http://localhost/api/mobile/v1/projects/${projectId}/updates/${updateId}/attachments/confirm`,
      { method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }
    ),
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
  return h.confirmUploadFor.mock.calls[0]?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireRole.mockReset();
  h.requireRole.mockResolvedValue(sessionAs("site"));
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.confirmUploadFor.mockReset();
  h.confirmUploadFor.mockResolvedValue({ id: ATTACHMENT_ID });
});

describe("POST /api/mobile/v1/projects/:projectId/updates/:updateId/attachments/confirm", () => {
  it.each(["admin", "site"] as const)(
    "records the photo for %s via the shared helper and returns { id } (201, no-store)",
    async (role) => {
      const session = sessionAs(role);
      h.requireRole.mockResolvedValue(session);

      const res = await call(UPLOADED);

      expect(res.status).toBe(201);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ id: ATTACHMENT_ID });
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.confirmUploadFor).toHaveBeenCalledExactlyOnceWith(session, {
        ...UPLOADED,
        projectId: PROJECT_ID,
        entityType: "daily_update",
        entityId: UPDATE_ID,
      });
    }
  );

  it("never lets the body choose the entity type, project or update", async () => {
    await call({
      ...UPLOADED,
      entityType: "approval",
      entityId: OTHER_UPDATE_ID,
      projectId: OTHER_PROJECT_ID,
      uploadedBy: "00000000-0000-4000-8000-0000000000d2",
    });

    expect(sentInput()).toEqual({
      ...UPLOADED,
      projectId: PROJECT_ID,
      entityType: "daily_update",
      entityId: UPDATE_ID,
    });
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call(UPLOADED);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.confirmUploadFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call(UPLOADED);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.confirmUploadFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, before anything is recorded", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin, site"));

    const res = await call(UPLOADED);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.confirmUploadFor).not.toHaveBeenCalled();
  });

  it.each([
    ["project", "not-a-uuid", UPDATE_ID],
    ["update", PROJECT_ID, "not-a-uuid"],
  ])("returns 404 for a %s id that is not a uuid", async (_l, p, u) => {
    const res = await call(UPLOADED, p, u);

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.confirmUploadFor).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no access to the project", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await call(UPLOADED);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.confirmUploadFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, PROJECT_ID, UPDATE_ID, "key=abc");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
  });

  it("returns 400 for a body that is not an object", async () => {
    const res = await call([UPLOADED]);

    await expectError(res, 400, "VALIDATION", "Request body must be a JSON object.");
  });

  it.each([
    ["a missing key", { fileName: "site.jpg", mimeType: "image/jpeg", sizeBytes: 1000 }],
    ["a blank key", { ...UPLOADED, key: "  " }],
    ["a type that is not allowed", { ...UPLOADED, mimeType: "application/zip" }],
    ["a negative size", { ...UPLOADED, sizeBytes: -1 }],
    ["a missing file name", { key: UPLOADED.key, mimeType: "image/jpeg", sizeBytes: 1000 }],
  ])("returns 400 for %s, with the schema's own message", async (_label, body) => {
    const res = await call(body);

    await expectError(res, 400, "VALIDATION", /./);
    expect(h.confirmUploadFor).not.toHaveBeenCalled();
  });

  it.each([
    [
      "FORBIDDEN: that key does not belong to this record",
      403,
      "FORBIDDEN",
      "You don't have permission to do that.",
    ],
    [
      "FORBIDDEN: only the author can add photos to a daily update",
      403,
      "FORBIDDEN",
      "You don't have permission to do that.",
    ],
    [
      "FORBIDDEN: those photos belong to another daily update",
      403,
      "FORBIDDEN",
      "You don't have permission to do that.",
    ],
    ["NOT_FOUND: that upload never completed", 404, "NOT_FOUND", "That record no longer exists."],
    [
      `NOT_FOUND: daily update ${UPDATE_ID} does not exist in this project`,
      404,
      "NOT_FOUND",
      "That record no longer exists.",
    ],
    [
      "REASON_REQUIRED: the uploaded file size does not match what was declared",
      422,
      "REASON_REQUIRED",
      "Please give a reason.",
    ],
    [
      "REASON_REQUIRED: this daily_update already has 4 attachments",
      422,
      "REASON_REQUIRED",
      "Please give a reason.",
    ],
    [
      "ILLEGAL_TRANSITION: that upload has already been recorded",
      409,
      "ILLEGAL_TRANSITION",
      "This request has already moved on. Refresh to see the current status.",
    ],
  ] as const)("maps %s to its status and copy", async (message, status, code, copy) => {
    h.confirmUploadFor.mockRejectedValue(new Error(message));

    const res = await call(UPLOADED);

    await expectError(res, status, code, copy);
  });

  it("returns 500 with a reference for an unexpected error, never the raw message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.confirmUploadFor.mockRejectedValue(new Error('relation "attachments" does not exist'));

    const res = await call(UPLOADED);

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
