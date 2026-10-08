import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required (a cookie session alone never
 * authorizes it), admin/site only, project access checked, only the listed
 * fields taken from the body — the URL's project and a server-generated id
 * authoritative, photos refused — validated by the web action's own
 * requestApprovalSchema (real, not mocked), the shared requestApprovalFor
 * called with the authenticated session, `{ id, projectId, status, refNo }`
 * returned (201, no-store), and the RPC's refusals — supersession's included —
 * mapped with mapDomainError's copy. The helper is mocked — it is tested in
 * features/approvals/create.test.ts, the RPC against Postgres in
 * tests/integration/approvals.test.ts.
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
    requestApprovalFor: vi.fn(),
    requireSession: vi.fn(),
    getApprovalsForProject: vi.fn(),
    getApprovalsPage: vi.fn(),
    countPendingApprovalsByProject: vi.fn(),
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
vi.mock("@/features/approvals/create", () => ({ requestApprovalFor: h.requestApprovalFor }));
vi.mock("@/features/approvals/queries", () => ({
  getApprovalsForProject: h.getApprovalsForProject,
  getApprovalsPage: h.getApprovalsPage,
  countPendingApprovalsByProject: h.countPendingApprovalsByProject,
}));

const { GET, POST } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-0000000000c2";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";
const PHASE_ID = "00000000-0000-4000-8000-0000000000f1";
const REJECTED_ID = "00000000-0000-4000-8000-0000000000a8";
const CLIENT_ID = "00000000-0000-4000-8000-0000000000b9";
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

const BODY = { packageId: PACKAGE_ID, type: "material_sample", item: "Pool tile 300x300" };

function call(body: unknown, projectId = PROJECT_ID, raw?: string) {
  return POST(
    new Request(`http://localhost/api/mobile/v1/projects/${projectId}/approvals`, {
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
  return h.requestApprovalFor.mock.calls[0]?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireRole.mockReset();
  h.requireRole.mockResolvedValue(sessionAs("site"));
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.requestApprovalFor.mockReset();
  h.requestApprovalFor.mockImplementation(async (_s: Session, input: { id: string; projectId: string }) => ({
    id: input.id,
    projectId: input.projectId,
    status: "pending",
    refNo: "AP-BHEL-NCH-007",
  }));
});

describe("POST /api/mobile/v1/projects/:projectId/approvals", () => {
  it("creates the approval and returns exactly { id, projectId, status, refNo } (201, no-store)", async () => {
    const res = await call(BODY);

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      id: sentInput().id,
      projectId: PROJECT_ID,
      status: "pending",
      refNo: "AP-BHEL-NCH-007",
    });
  });

  it.each(["admin", "site"] as const)(
    "lets %s through, calling the shared helper with that session and the full validated input",
    async (role) => {
      const session = sessionAs(role);
      h.requireRole.mockResolvedValue(session);

      const res = await call(BODY);

      expect(res.status).toBe(201);
      expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["admin", "site"]);
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.requestApprovalFor.mock.calls[0]?.[0]).toBe(session);
      expect(sentInput()).toEqual({
        id: expect.stringMatching(UUID_RE),
        projectId: PROJECT_ID,
        packageId: PACKAGE_ID,
        type: "material_sample",
        item: "Pool tile 300x300",
        attachmentIds: [],
      });
    }
  );

  it.each(["material_sample", "drawing", "make_model", "milestone", "other"])(
    "accepts the existing approval type %s",
    async (type) => {
      const res = await call({ ...BODY, type });

      expect(res.status).toBe(201);
      expect(sentInput().type).toBe(type);
    }
  );

  it("passes the optional phase, note and needed-by — the note and item trimmed", async () => {
    await call({
      ...BODY,
      item: "  Pool tile  ",
      phaseId: PHASE_ID,
      note: "  Two shades  ",
      neededBy: "2026-10-20",
    });

    expect(sentInput()).toMatchObject({
      item: "Pool tile",
      phaseId: PHASE_ID,
      note: "Two shades",
      neededBy: "2026-10-20",
    });
  });

  it('treats an empty phase, needed-by or supersedesId ("") as not given, as the web form does', async () => {
    await call({ ...BODY, phaseId: "", neededBy: "", supersedesId: "" });

    expect(sentInput().phaseId).toBeUndefined();
    expect(sentInput().neededBy).toBeUndefined();
    expect(sentInput().supersedesId).toBeUndefined();
  });

  it("makes the URL's project id authoritative over a body projectId", async () => {
    await call({ ...BODY, projectId: OTHER_PROJECT_ID });

    expect(h.requireProjectAccess.mock.calls[0]?.[1]).toBe(PROJECT_ID);
    expect(sentInput().projectId).toBe(PROJECT_ID);
  });

  it("uses the app's own approval id when one is sent — the same id on a retry", async () => {
    await call({ ...BODY, id: CLIENT_ID });

    expect(sentInput().id).toBe(CLIENT_ID);
  });

  it("generates a fresh id when none is sent (unchanged)", async () => {
    await call(BODY);

    expect(sentInput().id).toMatch(UUID_RE);
  });

  it.each([
    ["not a uuid", "not-a-uuid"],
    ["a number", 42],
    ["empty", ""],
  ])("returns 400 for an id that is %s, before anything is created", async (_label, id) => {
    const res = await call({ ...BODY, id });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("VALIDATION");
    expect(h.requestApprovalFor).not.toHaveBeenCalled();
  });

  it("answers a retry of an approval already created (same id) with 409 — never a second approval", async () => {
    h.requestApprovalFor
      .mockImplementationOnce(async (_s: Session, input: { id: string; projectId: string }) => ({
        id: input.id,
        projectId: input.projectId,
        status: "pending",
        refNo: "AP-BHEL-NCH-007",
      }))
      .mockRejectedValueOnce(new Error("ILLEGAL_TRANSITION: this approval has already been requested"));

    const first = await call({ ...BODY, id: CLIENT_ID });
    const retry = await call({ ...BODY, id: CLIENT_ID });

    expect(first.status).toBe(201);
    await expectError(
      retry,
      409,
      "ILLEGAL_TRANSITION",
      "This request has already moved on. Refresh to see the current status."
    );
    // Both attempts carried the same id to the helper — the database is what
    // refuses the second.
    expect(h.requestApprovalFor.mock.calls.map((c) => (c[1] as { id: string }).id)).toEqual([
      CLIENT_ID,
      CLIENT_ID,
    ]);
  });

  it("ignores fields the web form does not send (status, requestedBy, …)", async () => {
    await call({ ...BODY, status: "approved", requestedBy: CLIENT_ID, refNo: "AP-X" });

    const sent = sentInput();
    for (const key of ["status", "requestedBy", "refNo"]) expect(sent).not.toHaveProperty(key);
  });

  it.each([
    ["a list of photo ids", [CLIENT_ID]],
    ["a non-list value", "abc"],
  ])("refuses attachmentIds as %s (400) — photos are not part of this route yet", async (_label, value) => {
    const res = await call({ ...BODY, attachmentIds: value });

    await expectError(res, 400, "VALIDATION", "Photos can't be attached to an approval from the app yet.");
    expect(h.requestApprovalFor).not.toHaveBeenCalled();
  });

  describe("supersession — the RPC decides, the route passes it through", () => {
    it("revises a rejected approval: supersedesId reaches the helper", async () => {
      const res = await call({ ...BODY, supersedesId: REJECTED_ID });

      expect(res.status).toBe(201);
      expect(sentInput().supersedesId).toBe(REJECTED_ID);
    });

    it.each([
      [
        "an approval that is not rejected",
        "ILLEGAL_TRANSITION: only a rejected approval can be superseded",
        409,
        "ILLEGAL_TRANSITION",
      ],
      [
        "an approval already revised",
        `ILLEGAL_TRANSITION: approval ${REJECTED_ID} has already been superseded`,
        409,
        "ILLEGAL_TRANSITION",
      ],
      [
        "an approval of another project",
        `NOT_FOUND: superseded approval ${REJECTED_ID} does not exist in this project`,
        404,
        "NOT_FOUND",
      ],
    ] as const)("refuses revising %s", async (_label, message, status, code) => {
      h.requestApprovalFor.mockRejectedValue(new Error(message));

      const res = await call({ ...BODY, supersedesId: REJECTED_ID });

      await expectError(res, status, code, /./);
    });
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call(BODY);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.requestApprovalFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call(BODY);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requestApprovalFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, before any project or database work", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin, site"));

    const res = await call(BODY);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.requestApprovalFor).not.toHaveBeenCalled();
  });

  it("returns 404 for a project id that is not a uuid, before any project or database work", async () => {
    const res = await call(BODY, "not-a-uuid");

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.requestApprovalFor).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no access to the project", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await call(BODY);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requestApprovalFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, PROJECT_ID, "item=tile");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
    expect(h.requestApprovalFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not an object", async () => {
    const res = await call([BODY]);

    await expectError(res, 400, "VALIDATION", "Request body must be a JSON object.");
  });

  it.each([
    ["a missing package", { type: BODY.type, item: BODY.item }, /./],
    ["a package that is not a uuid", { ...BODY, packageId: "pool" }, /./],
    ["a missing type", { packageId: PACKAGE_ID, item: BODY.item }, /./],
    ["a type that does not exist", { ...BODY, type: "invoice" }, /./],
    ["a missing item", { packageId: PACKAGE_ID, type: BODY.type }, /./],
    ["a blank item", { ...BODY, item: "   " }, "Item is required"],
    ["an item that is not text", { ...BODY, item: 42 }, /./],
    ["a phase that is not a uuid", { ...BODY, phaseId: "phase-1" }, /./],
    ["a needed-by that is not yyyy-MM-dd", { ...BODY, neededBy: "20/10/2026" }, /./],
    ["a needed-by that is not a real date", { ...BODY, neededBy: "2026-02-30" }, /./],
    ["a note that is not text", { ...BODY, note: 42 }, /./],
    ["a supersedesId that is not a uuid", { ...BODY, supersedesId: "AP-1" }, /./],
  ])("returns 400 for %s, with the schema's own message", async (_label, body, message) => {
    const res = await call(body);

    await expectError(res, 400, "VALIDATION", message);
    expect(h.requestApprovalFor).not.toHaveBeenCalled();
  });

  it.each([
    [
      `NOT_FOUND: package ${PACKAGE_ID} does not exist in this project`,
      404,
      "NOT_FOUND",
      "That record no longer exists.",
    ],
    [
      "NOT_FOUND: one or more photos did not upload correctly — please retry them",
      404,
      "NOT_FOUND",
      "That record no longer exists.",
    ],
    [
      `FORBIDDEN: not a member of project ${PROJECT_ID}`,
      403,
      "FORBIDDEN",
      "You don't have permission to do that.",
    ],
    ["FORBIDDEN: requires admin or site", 403, "FORBIDDEN", "You don't have permission to do that."],
    ["REASON_REQUIRED: item is required", 422, "REASON_REQUIRED", "Please give a reason."],
  ] as const)("maps the helper's %s to its status and copy", async (message, status, code, copy) => {
    h.requestApprovalFor.mockRejectedValue(new Error(message));

    const res = await call(BODY);

    await expectError(res, status, code, copy);
  });

  it("returns 500 with a reference for an unexpected error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.requestApprovalFor.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "approvals_pkey"')
    );

    const res = await call(BODY);

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// ── GET ─────────────────────────────────────────────────────────────────────

/** An approval exactly as getApprovalsForProject returns it. */
function dto(over: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-0000000000a7",
    refNo: "AP-BHEL-NCH-007",
    packageId: PACKAGE_ID,
    packageName: "Swimming Pool",
    packageSeqNo: 1,
    phaseId: PHASE_ID,
    phaseName: "Waterproofing",
    type: "material_sample",
    item: "Pool tile 300x300",
    note: "Two shades",
    neededBy: "2026-10-20",
    status: "pending",
    requestedById: "00000000-0000-4000-8000-0000000000d5",
    requestedByName: "Ravi Kumar",
    requestedAt: "2026-10-01T06:30:00.000Z",
    decidedById: null,
    decidedByName: null,
    decidedAt: null,
    decisionReason: null,
    supersedesId: null,
    supersedesRefNo: null,
    supersededById: null,
    supersededByRefNo: null,
    canAddPhotos: true,
    canDecide: true,
    canSupersede: false,
    attachments: [
      {
        id: "00000000-0000-4000-8000-000000000a01",
        isImage: true,
        thumbUrl: "https://r2/t",
        downloadUrl: "https://r2/d",
      },
    ],
    ...over,
  };
}

function list(projectId = PROJECT_ID, search = "") {
  return GET(new Request(`http://localhost/api/mobile/v1/projects/${projectId}/approvals${search}`), {
    params: Promise.resolve({ projectId }),
  });
}

describe("GET /api/mobile/v1/projects/:projectId/approvals", () => {
  beforeEach(() => {
    h.requireSession.mockReset();
    h.requireSession.mockResolvedValue(sessionAs("site"));
    h.getApprovalsForProject.mockReset();
    h.getApprovalsForProject.mockResolvedValue([dto()]);
  });

  it.each(["admin", "site", "client"] as const)(
    "returns the approvals for %s with its role (200, no-store)",
    async (role) => {
      const session = sessionAs(role);
      h.requireSession.mockResolvedValue(session);

      const res = await list();

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body.role).toBe(role);
      expect(body.approvals).toHaveLength(1);
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.getApprovalsForProject).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
    }
  );

  it.each([
    ["admin", true],
    ["site", true],
    ["client", false],
  ] as const)("says whether a %s may raise a new approval (canRequest=%s)", async (role, expected) => {
    h.requireSession.mockResolvedValue(sessionAs(role));

    expect((await (await list()).json()).canRequest).toBe(expected);
  });

  it("returns each approval as the query shaped it, without the profile ids", async () => {
    const [row] = (await (await list()).json()).approvals;

    expect(row).not.toHaveProperty("requestedById");
    expect(row).not.toHaveProperty("decidedById");
    expect(row).toMatchObject({
      refNo: "AP-BHEL-NCH-007",
      item: "Pool tile 300x300",
      type: "material_sample",
      requestedByName: "Ravi Kumar",
      attachments: dto().attachments,
    });
  });

  it.each([
    // role, row status flags → what this user may do
    [
      "client",
      { canDecide: true, canAddPhotos: true, canSupersede: false },
      { canDecide: true, canAddPhotos: false, canSupersede: false },
    ],
    [
      "admin",
      { canDecide: true, canAddPhotos: true, canSupersede: false },
      { canDecide: false, canAddPhotos: true, canSupersede: false },
    ],
    [
      "site",
      { canDecide: true, canAddPhotos: true, canSupersede: false },
      { canDecide: false, canAddPhotos: true, canSupersede: false },
    ],
    [
      "site",
      { status: "rejected", canDecide: false, canAddPhotos: false, canSupersede: true },
      { canDecide: false, canAddPhotos: false, canSupersede: true },
    ],
    [
      "admin",
      { status: "rejected", canDecide: false, canAddPhotos: false, canSupersede: true },
      { canDecide: false, canAddPhotos: false, canSupersede: true },
    ],
    [
      "client",
      { status: "rejected", canDecide: false, canAddPhotos: false, canSupersede: true },
      { canDecide: false, canAddPhotos: false, canSupersede: false },
    ],
    [
      "admin",
      { status: "approved", canDecide: false, canAddPhotos: false, canSupersede: false },
      { canDecide: false, canAddPhotos: false, canSupersede: false },
    ],
  ] as const)(
    "gives a %s %j the actions %j — the web's can(role) and the row's own flag",
    async (role, flags, expected) => {
      h.requireSession.mockResolvedValue(sessionAs(role));
      h.getApprovalsForProject.mockResolvedValue([dto(flags)]);

      const [row] = (await (await list()).json()).approvals;

      expect({
        canDecide: row.canDecide,
        canAddPhotos: row.canAddPhotos,
        canSupersede: row.canSupersede,
      }).toEqual(expected);
    }
  );

  it("returns an empty list for a project with no approvals", async () => {
    h.getApprovalsForProject.mockResolvedValue([]);

    expect(await (await list()).json()).toEqual({ role: "site", canRequest: true, approvals: [] });
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await list();

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.getApprovalsForProject).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await list();

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
  });

  it("returns 404 for a project id that is not a uuid, before any read", async () => {
    const res = await list("not-a-uuid");

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.getApprovalsForProject).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no access to the project", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await list();

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.getApprovalsForProject).not.toHaveBeenCalled();
  });

  it("returns 500 with a reference for a query error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.getApprovalsForProject.mockRejectedValue(new Error('relation "approvals" does not exist'));

    const res = await list();

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    consoleError.mockRestore();
  });
});

describe("GET /api/mobile/v1/projects/:projectId/approvals — paged (?page / ?status)", () => {
  function pageOf(rows: unknown[], total = rows.length, page = 1) {
    return { rows, total, page, pageSize: 25 };
  }

  beforeEach(() => {
    h.requireSession.mockReset();
    h.requireSession.mockResolvedValue(sessionAs("site"));
    h.requireProjectAccess.mockReset();
    h.requireProjectAccess.mockResolvedValue(undefined);
    h.getApprovalsForProject.mockReset();
    h.getApprovalsPage.mockReset();
    h.getApprovalsPage.mockResolvedValue(pageOf([dto()]));
    h.countPendingApprovalsByProject.mockReset();
    h.countPendingApprovalsByProject.mockResolvedValue({ [PROJECT_ID]: 3 });
  });

  it.each(["admin", "site", "client"] as const)(
    "pages the web table's own query for %s, with the pending count and paging info",
    async (role) => {
      const session = sessionAs(role);
      h.requireSession.mockResolvedValue(session);

      const res = await list(PROJECT_ID, "?page=1");

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(
        ["approvals", "canRequest", "hasMore", "page", "pageSize", "pendingCount", "role", "total"].sort()
      );
      expect(body).toMatchObject({ role, pendingCount: 3, total: 1, page: 1, pageSize: 25, hasMore: false });
      expect(body.canRequest).toBe(role !== "client");
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.getApprovalsPage).toHaveBeenCalledExactlyOnceWith(
        session,
        PROJECT_ID,
        {},
        { page: 1, pageSize: 25 }
      );
      expect(h.countPendingApprovalsByProject).toHaveBeenCalledExactlyOnceWith([PROJECT_ID]);
      expect(h.getApprovalsForProject).not.toHaveBeenCalled();
    }
  );

  it("shapes each row exactly as the unpaged list does — flags, revision links and photos kept", async () => {
    h.requireSession.mockResolvedValue(sessionAs("client"));
    const row = dto({ supersedesId: REJECTED_ID, supersedesRefNo: "AP-BHEL-NCH-006" });
    h.getApprovalsPage.mockResolvedValue(pageOf([row]));
    h.getApprovalsForProject.mockResolvedValue([row]);

    const paged = (await (await list(PROJECT_ID, "?page=1")).json()).approvals;
    const whole = (await (await list()).json()).approvals;

    expect(paged).toEqual(whole);
    expect(paged[0]).toMatchObject({
      supersedesRefNo: "AP-BHEL-NCH-006",
      canDecide: true,
      canAddPhotos: false,
    });
    expect(paged[0].attachments).toHaveLength(1);
    expect(paged[0]).not.toHaveProperty("requestedById");
  });

  it.each(["pending", "approved", "rejected"] as const)(
    "filters by status=%s in the query",
    async (status) => {
      await list(PROJECT_ID, `?status=${status}&page=2`);

      expect(h.getApprovalsPage).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        PROJECT_ID,
        { status },
        { page: 2, pageSize: 25 }
      );
    }
  );

  it("a status alone pages from page 1", async () => {
    await list(PROJECT_ID, "?status=pending");

    expect(h.getApprovalsPage.mock.calls[0]?.[3]).toEqual({ page: 1, pageSize: 25 });
  });

  it("says hasMore from the query's total, and returns the page actually served", async () => {
    h.getApprovalsPage.mockResolvedValue(pageOf([dto()], 60, 2));

    const body = await (await list(PROJECT_ID, "?page=2")).json();

    expect(body).toMatchObject({ total: 60, page: 2, pageSize: 25, hasMore: true });
  });

  it("returns an empty page with a zero pending count for a project with none", async () => {
    h.getApprovalsPage.mockResolvedValue(pageOf([], 0));
    h.countPendingApprovalsByProject.mockResolvedValue({});

    const body = await (await list(PROJECT_ID, "?page=1")).json();

    expect(body).toMatchObject({ approvals: [], pendingCount: 0, total: 0, hasMore: false });
  });

  it.each([
    ["?status=all", "status must be one of: pending, approved, rejected."],
    ["?status=Pending", "status must be one of: pending, approved, rejected."],
    ["?page=0", "page must be a whole number from 1 to 1000."],
    ["?page=1.5", "page must be a whole number from 1 to 1000."],
    ["?page=abc", "page must be a whole number from 1 to 1000."],
    ["?page=1001", "page must be a whole number from 1 to 1000."],
  ])("returns 400 for %s, before any access check or read", async (search, message) => {
    await expectError(await list(PROJECT_ID, search), 400, "VALIDATION", message);
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getApprovalsPage).not.toHaveBeenCalled();
  });

  it("still enforces project access when paged — 403, no read", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    await expectError(
      await list(PROJECT_ID, "?page=1"),
      403,
      "FORBIDDEN",
      "You don't have permission to do that."
    );
    expect(h.getApprovalsPage).not.toHaveBeenCalled();
    expect(h.countPendingApprovalsByProject).not.toHaveBeenCalled();
  });

  it("returns 401 with no Bearer header, before any read", async () => {
    h.bearerToken = null;

    await expectError(
      await list(PROJECT_ID, "?page=1"),
      401,
      "UNAUTHENTICATED",
      "Your session expired. Please sign in again."
    );
    expect(h.getApprovalsPage).not.toHaveBeenCalled();
  });

  it("returns 500 with a reference for a query error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.getApprovalsPage.mockRejectedValue(new Error('relation "approvals" does not exist'));

    await expectError(
      await list(PROJECT_ID, "?page=1"),
      500,
      "INTERNAL",
      /^Something went wrong\. Reference: [0-9a-f-]{36}$/
    );
    consoleError.mockRestore();
  });
});
