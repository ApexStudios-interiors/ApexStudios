import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * GET: Bearer required, any role, project access checked, the query
 * (getUpdatesForProject, mocked) called with the session and returned as
 * `{ role, updates, hasMore, nextCursor }` without authorId, no-store; the
 * optional `packageId` and `cursor` passed through to the query's own
 * options after validation (400), project access enforced either way.
 *
 * POST: Bearer required, admin/site only, project access checked, the URL's
 * project id authoritative, the client's own update id used exactly (a fresh
 * server id only for a text-only post that sends none), photo ids passed
 * through for the helper to re-check, a retry answered 409, the body
 * validated by the web action's own
 * postDailyUpdateSchema (real, not mocked), the shared postDailyUpdateFor
 * called with the authenticated session, and errors mapped to statuses with
 * mapDomainError's copy. The helper is mocked — it is tested in
 * features/updates/write.test.ts, the database rules against Postgres in
 * tests/integration/files-and-jobs.test.ts.
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
    postDailyUpdateFor: vi.fn(),
    requireSession: vi.fn(),
    getUpdatesForProject: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireRole: h.requireRole,
  requireProjectAccess: h.requireProjectAccess,
  requireSession: h.requireSession,
}));
vi.mock("@/lib/supabase/server", () => ({
  getBearerToken: async () => h.bearerToken,
  createClient: vi.fn(),
}));
vi.mock("@/features/updates/write", () => ({ postDailyUpdateFor: h.postDailyUpdateFor }));
// The cursor check is the query module's own (pure) one; only the query is
// mocked (and R2 presigning, which the real module imports, never reached).
vi.mock("@/lib/r2/presign", () => ({ presignGet: vi.fn() }));
vi.mock("@/features/updates/queries", async (importOriginal) => ({
  isValidUpdatesCursor: (await importOriginal<typeof import("@/features/updates/queries")>())
    .isValidUpdatesCursor,
  getUpdatesForProject: h.getUpdatesForProject,
}));

const { GET, POST } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-0000000000c2";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";
const CLIENT_ID = "00000000-0000-4000-8000-0000000000b9";
const ATT_1 = "00000000-0000-4000-8000-000000000a01";
const ATT_2 = "00000000-0000-4000-8000-000000000a02";
const ATT_3 = "00000000-0000-4000-8000-000000000a03";
const ATT_4 = "00000000-0000-4000-8000-000000000a04";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

const BODY = { packageId: PACKAGE_ID, updateDate: "2026-10-07", body: "Waterproofing coat two done" };

function call(body: unknown, projectId = PROJECT_ID, raw?: string) {
  return POST(
    new Request(`http://localhost/api/mobile/v1/projects/${projectId}/updates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId }) }
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

/** The input the helper received. */
function sentInput() {
  return h.postDailyUpdateFor.mock.calls[0]?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireRole.mockReset();
  h.requireRole.mockResolvedValue(sessionAs("site"));
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.postDailyUpdateFor.mockReset();
  h.postDailyUpdateFor.mockImplementation(async (_session: Session, input: { id: string }) => ({
    id: input.id,
  }));
});

describe("POST /api/mobile/v1/projects/:projectId/updates", () => {
  it("posts the update and returns { id } (201, no-store)", async () => {
    const res = await call(BODY);

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["id"]);
    expect(body.id).toBe(sentInput().id);
  });

  it.each(["admin", "site"] as const)(
    "lets %s through, calling the shared helper with that authenticated session",
    async (role) => {
      const session = sessionAs(role);
      h.requireRole.mockResolvedValue(session);

      const res = await call(BODY);

      expect(res.status).toBe(201);
      expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["admin", "site"]);
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.postDailyUpdateFor).toHaveBeenCalledOnce();
      expect(h.postDailyUpdateFor.mock.calls[0]?.[0]).toBe(session);
      expect(sentInput()).toEqual({
        id: expect.stringMatching(UUID_RE),
        projectId: PROJECT_ID,
        packageId: PACKAGE_ID,
        updateDate: "2026-10-07",
        body: "Waterproofing coat two done",
        attachmentIds: [],
      });
    }
  );

  it("makes the URL's project id authoritative over a body projectId", async () => {
    await call({ ...BODY, projectId: OTHER_PROJECT_ID });

    expect(h.requireProjectAccess.mock.calls[0]?.[1]).toBe(PROJECT_ID);
    expect(sentInput().projectId).toBe(PROJECT_ID);
  });

  it("generates a fresh server id for a text-only post that sends none", async () => {
    await call(BODY);
    const first = sentInput().id;
    h.postDailyUpdateFor.mockClear();
    await call(BODY);

    expect(first).toMatch(UUID_RE);
    expect(sentInput().id).toMatch(UUID_RE);
    expect(sentInput().id).not.toBe(first);
  });

  it("accepts an empty attachmentIds list as text-only", async () => {
    const res = await call({ ...BODY, attachmentIds: [] });

    expect(res.status).toBe(201);
    expect(sentInput().attachmentIds).toEqual([]);
  });

  it("posts with the client's own id — exactly as sent — and returns it", async () => {
    const res = await call({ ...BODY, id: CLIENT_ID });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: CLIENT_ID });
    expect(sentInput().id).toBe(CLIENT_ID);
  });

  it("passes the client's id and photo ids to the shared helper, which re-checks every photo", async () => {
    const photos = [ATT_1, ATT_2];

    const res = await call({ ...BODY, id: CLIENT_ID, attachmentIds: photos });

    expect(res.status).toBe(201);
    expect(sentInput()).toEqual({
      id: CLIENT_ID,
      projectId: PROJECT_ID,
      packageId: PACKAGE_ID,
      updateDate: "2026-10-07",
      body: "Waterproofing coat two done",
      attachmentIds: photos,
    });
  });

  it("refuses photos without the id they were uploaded for (400)", async () => {
    const res = await call({ ...BODY, attachmentIds: [ATT_1] });

    await expectError(
      res,
      400,
      "VALIDATION",
      "An update with photos needs the id its photos were uploaded for."
    );
    expect(h.postDailyUpdateFor).not.toHaveBeenCalled();
  });

  it.each([
    ["an id that is not a uuid", { id: "my-update" }],
    ["an id that is not text", { id: 42 }],
    ["a photo id that is not a uuid", { id: CLIENT_ID, attachmentIds: ["photo-1"] }],
    ["photo ids that are not a list", { id: CLIENT_ID, attachmentIds: "abc" }],
    [
      "more than four photos",
      { id: CLIENT_ID, attachmentIds: [ATT_1, ATT_2, ATT_3, ATT_4, "00000000-0000-4000-8000-000000000a05"] },
    ],
  ])("returns 400 for %s, with the schema's own message", async (_label, extra) => {
    const res = await call({ ...BODY, ...extra });

    await expectError(res, 400, "VALIDATION", /./);
    expect(h.postDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("answers a retry of an already-posted id with 409, never a second update", async () => {
    h.postDailyUpdateFor.mockRejectedValue(
      new Error("ILLEGAL_TRANSITION: this daily update has already been posted")
    );

    const res = await call({ ...BODY, id: CLIENT_ID });

    await expectError(
      res,
      409,
      "ILLEGAL_TRANSITION",
      "This request has already moved on. Refresh to see the current status."
    );
  });

  it.each([
    [
      "a photo that is not this user's own upload for this id",
      "NOT_FOUND: one or more photos did not upload correctly — please retry them",
      404,
      "NOT_FOUND",
    ],
    [
      "an id carrying someone else's photos",
      "FORBIDDEN: those photos belong to another daily update",
      403,
      "FORBIDDEN",
    ],
  ] as const)("maps the refusal of %s", async (_label, message, status, code) => {
    h.postDailyUpdateFor.mockRejectedValue(new Error(message));

    const res = await call({ ...BODY, id: CLIENT_ID, attachmentIds: [ATT_1] });

    await expectError(res, status, code, /./);
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call(BODY);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.postDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call(BODY);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.postDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, before any project or database work", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin, site"));

    const res = await call(BODY);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.postDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("returns 404 for a project id that is not a uuid, before any project or database work", async () => {
    const res = await call(BODY, "not-a-uuid");

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.postDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no access to the project", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await call(BODY);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.postDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, PROJECT_ID, "body=hello");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
    expect(h.postDailyUpdateFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not an object", async () => {
    const res = await call([BODY]);

    await expectError(res, 400, "VALIDATION", "Request body must be a JSON object.");
  });

  it.each([
    ["a blank body", { ...BODY, body: "   " }, "Please describe what happened today"],
    ["a missing package", { updateDate: BODY.updateDate, body: BODY.body }, /./],
    ["a package that is not a uuid", { ...BODY, packageId: "pool" }, /./],
    ["a date that is not yyyy-MM-dd", { ...BODY, updateDate: "07/10/2026" }, /./],
  ])("returns 400 for %s, with the schema's own message", async (_label, body, message) => {
    const res = await call(body);

    await expectError(res, 400, "VALIDATION", message);
    expect(h.postDailyUpdateFor).not.toHaveBeenCalled();
  });

  it.each([
    [
      "NOT_FOUND: package x does not exist in this project",
      404,
      "NOT_FOUND",
      "That record no longer exists.",
    ],
    ["FORBIDDEN: not a member of project x", 403, "FORBIDDEN", "You don't have permission to do that."],
  ] as const)("maps the helper's %s to its status and copy", async (message, status, code, copy) => {
    h.postDailyUpdateFor.mockRejectedValue(new Error(message));

    const res = await call(BODY);

    await expectError(res, status, code, copy);
  });

  it("returns 500 with a reference for an unexpected error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.postDailyUpdateFor.mockRejectedValue(
      new Error('new row violates row-level security policy for table "daily_updates"')
    );

    const res = await call(BODY);

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

/** An update exactly as getUpdatesForProject returns it. */
const UPDATE = {
  id: "00000000-0000-4000-8000-0000000000b1",
  packageId: PACKAGE_ID,
  packageName: "Swimming Pool",
  packageSeqNo: 1,
  updateDate: "2026-10-07",
  body: "Waterproofing coat two done",
  authorId: "00000000-0000-4000-8000-0000000000d5",
  authorName: "Ravi Kumar",
  createdAt: "2026-10-07T06:30:00.000Z",
  canEdit: true,
  attachments: [
    {
      id: "00000000-0000-4000-8000-000000000a01",
      isImage: true,
      thumbUrl: "https://r2/t",
      downloadUrl: "https://r2/d",
    },
  ],
};

function get(projectId = PROJECT_ID, search = "") {
  return GET(new Request(`http://localhost/api/mobile/v1/projects/${projectId}/updates${search}`), {
    params: Promise.resolve({ projectId }),
  });
}

/** A cursor exactly as the query encodes one (base64url JSON of the last row). */
function cursorOf(c: unknown) {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}
const CURSOR = cursorOf({
  updateDate: "2026-10-06",
  createdAt: "2026-10-06T09:15:00.123456+00:00",
  id: "00000000-0000-4000-8000-0000000000b2",
});

describe("GET /api/mobile/v1/projects/:projectId/updates", () => {
  beforeEach(() => {
    h.requireSession.mockReset();
    h.requireSession.mockResolvedValue(sessionAs("site"));
    h.getUpdatesForProject.mockReset();
    h.getUpdatesForProject.mockResolvedValue({ items: [UPDATE], nextCursor: null });
  });

  it.each(["admin", "site", "client"] as const)(
    "returns the first page for %s with the session's role (200, no-store)",
    async (role) => {
      const session = sessionAs(role);
      h.requireSession.mockResolvedValue(session);

      const res = await get();

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body.role).toBe(role);
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.getUpdatesForProject).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID, {
        packageId: undefined,
        cursor: undefined,
      });
    }
  );

  it("returns each update as the query shaped it, without authorId", async () => {
    const body = await (await get()).json();

    const shown: Record<string, unknown> = { ...UPDATE };
    delete shown.authorId;
    expect(body).toEqual({ role: "site", updates: [shown], hasMore: false, nextCursor: null });
    expect(Object.keys(body).sort()).toEqual(["hasMore", "nextCursor", "role", "updates"]);
    expect(body.updates[0]).not.toHaveProperty("authorId");
  });

  it("says hasMore and returns the query's own nextCursor when it has an older page", async () => {
    h.getUpdatesForProject.mockResolvedValue({ items: [UPDATE], nextCursor: CURSOR });

    const body = await (await get()).json();

    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe(CURSOR);
  });

  it("filters by a valid packageId, passing it to the query's own package option", async () => {
    const session = sessionAs("client");
    h.requireSession.mockResolvedValue(session);

    const res = await get(PROJECT_ID, `?packageId=${PACKAGE_ID}`);

    expect(res.status).toBe(200);
    expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
    expect(h.getUpdatesForProject).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID, {
      packageId: PACKAGE_ID,
      cursor: undefined,
    });
  });

  it("loads the next page for a valid cursor (with the package filter kept)", async () => {
    h.getUpdatesForProject.mockResolvedValue({ items: [UPDATE], nextCursor: null });

    const res = await get(PROJECT_ID, `?packageId=${PACKAGE_ID}&cursor=${CURSOR}`);

    expect(res.status).toBe(200);
    expect(h.getUpdatesForProject).toHaveBeenCalledExactlyOnceWith(sessionAs("site"), PROJECT_ID, {
      packageId: PACKAGE_ID,
      cursor: CURSOR,
    });
    const body = await res.json();
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it.each([
    ["not a uuid", "?packageId=not-a-uuid"],
    ["empty", "?packageId="],
    ["a filter injection", `?packageId=${PACKAGE_ID},project_id.neq.x`],
  ])("returns 400 for a packageId that is %s, before any access check or read", async (_label, search) => {
    const res = await get(PROJECT_ID, search);

    await expectError(res, 400, "VALIDATION", "packageId must be a valid id.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getUpdatesForProject).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["not base64 JSON", "not-a-cursor"],
    ["JSON missing fields", cursorOf({ updateDate: "2026-10-06" })],
    [
      "a field carrying a filter injection",
      cursorOf({
        updateDate: "2026-10-06,project_id.neq.x",
        createdAt: "2026-10-06T09:15:00+00:00",
        id: "00000000-0000-4000-8000-0000000000b2",
      }),
    ],
    [
      "an id that is not a uuid",
      cursorOf({ updateDate: "2026-10-06", createdAt: "2026-10-06T09:15:00Z", id: "x" }),
    ],
    ["far too long", "a".repeat(600)],
  ])("returns 400 for a cursor that is %s, before any access check or read", async (_label, raw) => {
    const res = await get(PROJECT_ID, `?cursor=${encodeURIComponent(raw)}`);

    await expectError(res, 400, "VALIDATION", "cursor is not valid.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getUpdatesForProject).not.toHaveBeenCalled();
  });

  it("still enforces project access when filtering by package — 403, no read", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await get(PROJECT_ID, `?packageId=${PACKAGE_ID}&cursor=${CURSOR}`);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.getUpdatesForProject).not.toHaveBeenCalled();
  });

  it("checks access against the URL's project, so another project's package only narrows that project", async () => {
    h.getUpdatesForProject.mockResolvedValue({ items: [], nextCursor: null });

    const res = await get(OTHER_PROJECT_ID, `?packageId=${PACKAGE_ID}`);

    expect(res.status).toBe(200);
    expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(sessionAs("site"), OTHER_PROJECT_ID);
    expect(h.getUpdatesForProject.mock.calls[0]?.[1]).toBe(OTHER_PROJECT_ID);
    expect(await res.json()).toEqual({ role: "site", updates: [], hasMore: false, nextCursor: null });
  });

  it("returns an empty list for a project with no updates", async () => {
    h.getUpdatesForProject.mockResolvedValue({ items: [], nextCursor: null });

    const body = await (await get()).json();

    expect(body).toEqual({ role: "site", updates: [], hasMore: false, nextCursor: null });
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await get();

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.getUpdatesForProject).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await get();

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.getUpdatesForProject).not.toHaveBeenCalled();
  });

  it("returns 404 for a project id that is not a uuid, before any project or data read", async () => {
    const res = await get("not-a-uuid");

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getUpdatesForProject).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no access to the project", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await get();

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.getUpdatesForProject).not.toHaveBeenCalled();
  });

  it("returns 500 with a reference for a query error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.getUpdatesForProject.mockRejectedValue(new Error('relation "daily_updates" does not exist'));

    const res = await get();

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
