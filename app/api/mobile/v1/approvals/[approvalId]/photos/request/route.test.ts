import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required (a cookie session alone never
 * authorizes it), admin/site only, the approval id checked, the approval
 * looked up as existing-and-pending (approvalForPhotos, mocked) and its
 * project's access checked, only the file's own facts taken from the body —
 * the entity (this approval), its project and the entity type always the
 * server's — validated by the web's own schema (real, not mocked), the shared
 * requestUploadFor called with the session, and errors mapped with
 * mapDomainError's copy. The helpers are tested in
 * features/approvals/photos.test.ts and features/attachments/actions.test.ts.
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
    approvalForPhotos: vi.fn(),
    helper: vi.fn(),
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
vi.mock("@/features/approvals/photos", () => ({ approvalForPhotos: h.approvalForPhotos }));
vi.mock("@/features/attachments/upload", () => ({ requestUploadFor: h.helper }));

const { POST } = await import("./route");

const APPROVAL_ID = "00000000-0000-4000-8000-0000000000a9";
const OTHER_ID = "00000000-0000-4000-8000-0000000000a8";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-0000000000c2";
const KEY = `org/00000000-0000-4000-8000-0000000000a0/project/${PROJECT_ID}/approval/${APPROVAL_ID}/u-sample.jpg`;

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

const FILE = { fileName: "sample.jpg", mimeType: "image/jpeg", sizeBytes: 245_000 };

function call(body: unknown, approvalId = APPROVAL_ID, raw?: string) {
  return POST(
    new Request(`http://localhost/api/mobile/v1/approvals/${approvalId}/photos/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ approvalId }) }
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
  h.approvalForPhotos.mockReset();
  h.approvalForPhotos.mockResolvedValue({ id: APPROVAL_ID, projectId: PROJECT_ID, status: "pending" });
  h.helper.mockReset();
  h.helper.mockResolvedValue({ url: "https://r2.example/put", key: KEY });
});

describe("POST /api/mobile/v1/approvals/:approvalId/photos/request", () => {
  it.each(["admin", "site"] as const)(
    "works for %s (200, no-store), on this approval's project",
    async (role) => {
      const session = sessionAs(role);
      h.requireRole.mockResolvedValue(session);

      const res = await call(FILE);

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ url: "https://r2.example/put", key: KEY });
      expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["admin", "site"]);
      expect(h.approvalForPhotos).toHaveBeenCalledExactlyOnceWith(APPROVAL_ID);
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.helper).toHaveBeenCalledExactlyOnceWith(session, {
        ...FILE,
        projectId: PROJECT_ID,
        entityType: "approval",
        entityId: APPROVAL_ID,
      });
    }
  );

  it("never lets the body choose the entity type, the approval or the project", async () => {
    await call({ ...FILE, entityType: "daily_update", entityId: OTHER_ID, projectId: OTHER_PROJECT_ID });

    expect(h.helper.mock.calls[0]?.[1]).toEqual({
      ...FILE,
      projectId: PROJECT_ID,
      entityType: "approval",
      entityId: APPROVAL_ID,
    });
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call(FILE);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.helper).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call(FILE);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.helper).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, before the approval is even looked up", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin, site"));

    const res = await call(FILE);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.approvalForPhotos).not.toHaveBeenCalled();
    expect(h.helper).not.toHaveBeenCalled();
  });

  it("returns 404 for an approval id that is not a uuid", async () => {
    const res = await call(FILE, "not-a-uuid");

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.approvalForPhotos).not.toHaveBeenCalled();
  });

  it("returns 404 for an approval this user cannot see or that does not exist", async () => {
    h.approvalForPhotos.mockRejectedValue(new Error("NOT_FOUND: this approval no longer exists"));

    const res = await call(FILE);

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.helper).not.toHaveBeenCalled();
  });

  it("returns 409 for an approval that is no longer pending", async () => {
    h.approvalForPhotos.mockRejectedValue(
      new Error("ILLEGAL_TRANSITION: photos can only be added to a pending approval")
    );

    const res = await call(FILE);

    await expectError(
      res,
      409,
      "ILLEGAL_TRANSITION",
      "This request has already moved on. Refresh to see the current status."
    );
    expect(h.helper).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no access to the approval's project", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await call(FILE);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.helper).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, APPROVAL_ID, "fileName=x");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
  });

  it("returns 400 for a body that is not an object", async () => {
    const res = await call([FILE]);

    await expectError(res, 400, "VALIDATION", "Request body must be a JSON object.");
  });

  it.each([
    ["a type that is not allowed", { ...FILE, mimeType: "image/gif" }],
    ["a missing file name", { ...FILE, fileName: undefined }],
    ["a zero size", { ...FILE, sizeBytes: 0 }],
  ])("returns 400 for %s, with the schema's own message", async (_label, body) => {
    const res = await call(body);

    await expectError(res, 400, "VALIDATION", /./);
    expect(h.helper).not.toHaveBeenCalled();
  });

  it.each([
    ["REASON_REQUIRED: this approval already has 4 attachments", 422, "REASON_REQUIRED"],
    ["FORBIDDEN: that key does not belong to this record", 403, "FORBIDDEN"],
    ["NOT_FOUND: that upload never completed", 404, "NOT_FOUND"],
  ] as const)("maps the helper's %s", async (message, status, code) => {
    h.helper.mockRejectedValue(new Error(message));

    const res = await call(FILE);

    await expectError(res, status, code, /./);
  });

  it("returns 500 with a reference for an unexpected error, never the raw message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.helper.mockRejectedValue(
      new Error('new row violates row-level security policy for table "attachments"')
    );

    const res = await call(FILE);

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    consoleError.mockRestore();
  });
});
