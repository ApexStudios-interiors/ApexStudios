import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required, admin/site only, project access
 * checked, the URL's project id authoritative, the body validated by the web
 * action's own createStockRequestSchema (real, not mocked), the shared
 * createStockRequestFor called with the authenticated session, and errors
 * mapped to statuses with mapDomainError's copy. The helper is mocked — its
 * D55 rule is tested in features/stock/create.test.ts, the RPC against
 * Postgres in tests/integration/stock-and-inventory.test.ts.
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
    createStockRequestFor: vi.fn(),
    getStockRequestsPage: vi.fn(),
    countPendingRequestsByProject: vi.fn(),
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
vi.mock("@/features/stock/create", () => ({ createStockRequestFor: h.createStockRequestFor }));
vi.mock("@/features/stock/queries", () => ({
  getStockRequestsPage: h.getStockRequestsPage,
  countPendingRequestsByProject: h.countPendingRequestsByProject,
}));
// The real pure rules, wrapped in spies — so a test can prove each row's
// `actions` / `atRisk` came from them, with the arguments they were given.
vi.mock("@/features/stock/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/stock/service")>();
  return {
    ...actual,
    availableTransitions: vi.fn(actual.availableTransitions),
    isDeadlineAtRisk: vi.fn(actual.isDeadlineAtRisk),
  };
});
// "Today" in India, fixed for the at-risk rule.
vi.mock("@/lib/dates", () => ({ todayIst: () => "2026-10-07" }));

const { GET, POST } = await import("./route");
const service = await import("@/features/stock/service");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-0000000000c2";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";

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

/** A valid body — no needed-by, so it never depends on today's date. */
const BODY = { packageId: PACKAGE_ID, materialName: "Cement", qty: 120, unit: "bag", rate: 410 };

function call(body: unknown, projectId = PROJECT_ID, raw?: string) {
  return POST(
    new Request(`http://localhost/api/mobile/v1/projects/${projectId}/stock-requests`, {
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

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireRole.mockReset();
  h.requireRole.mockResolvedValue(sessionAs("site"));
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.createStockRequestFor.mockReset();
  h.createStockRequestFor.mockResolvedValue({ id: "sr-1", refNo: "SR-BHEL-NCH-014" });
});

describe("POST /api/mobile/v1/projects/:projectId/stock-requests", () => {
  it("creates the request and returns { id, refNo } (201, no-store)", async () => {
    const res = await call(BODY);

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: "sr-1", refNo: "SR-BHEL-NCH-014" });
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
      expect(h.createStockRequestFor).toHaveBeenCalledOnce();
      expect(h.createStockRequestFor.mock.calls[0]?.[0]).toBe(session);
      expect(h.createStockRequestFor.mock.calls[0]?.[1]).toMatchObject({
        projectId: PROJECT_ID,
        packageId: PACKAGE_ID,
        materialName: "Cement",
        qty: 120,
        unit: "bag",
        rate: 410,
      });
    }
  );

  it("makes the URL's project id authoritative over a body projectId", async () => {
    await call({ ...BODY, projectId: OTHER_PROJECT_ID });

    expect(h.requireProjectAccess.mock.calls[0]?.[1]).toBe(PROJECT_ID);
    expect(h.createStockRequestFor.mock.calls[0]?.[1]).toMatchObject({ projectId: PROJECT_ID });
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call(BODY);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.createStockRequestFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call(BODY);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.createStockRequestFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, before any project or database work", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin, site"));

    const res = await call(BODY);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.createStockRequestFor).not.toHaveBeenCalled();
  });

  it("returns 404 for a project id that is not a uuid, before any project or database work", async () => {
    const res = await call(BODY, "not-a-uuid");

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.createStockRequestFor).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no access to the project", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await call(BODY);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.createStockRequestFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, PROJECT_ID, "materialName=Cement");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
    expect(h.createStockRequestFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not an object", async () => {
    const res = await call([BODY]);

    await expectError(res, 400, "VALIDATION", "Request body must be a JSON object.");
  });

  it.each([
    ["a zero quantity", { ...BODY, qty: 0 }, "Quantity must be positive"],
    ["a negative quantity", { ...BODY, qty: -5 }, "Quantity must be positive"],
    ["a negative rate", { ...BODY, rate: -1 }, "Rate cannot be negative"],
    [
      "a needed-by date in the past",
      { ...BODY, neededBy: "2020-01-01" },
      "Needed-by date cannot be in the past",
    ],
    ["a blank material name", { ...BODY, materialName: "   " }, "Material name is required"],
  ])("returns 400 for %s, with the schema's own message", async (_label, body, message) => {
    const res = await call(body);

    await expectError(res, 400, "VALIDATION", message);
    expect(h.createStockRequestFor).not.toHaveBeenCalled();
  });

  it.each([
    [
      "NOT_FOUND: package x does not exist in this project",
      404,
      "NOT_FOUND",
      "That record no longer exists.",
    ],
    ["FORBIDDEN: not a member of project x", 403, "FORBIDDEN", "You don't have permission to do that."],
    ["REASON_REQUIRED: quantity must be positive", 422, "REASON_REQUIRED", "Please give a reason."],
  ] as const)("maps the RPC's %s to its status and copy", async (pgMessage, status, code, message) => {
    h.createStockRequestFor.mockRejectedValue(new Error(pgMessage));

    const res = await call(BODY);

    await expectError(res, status, code, message);
  });

  it("returns 500 with a reference for an unexpected error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.createStockRequestFor.mockRejectedValue(new Error('relation "stock_requests" does not exist'));

    const res = await call(BODY);

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// ── GET ─────────────────────────────────────────────────────────────────────

/** A row exactly as getStockRequestsPage returns it (admin-shaped). */
function dto(over: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000501",
    refNo: "SR-BHEL-NCH-014",
    projectId: PROJECT_ID,
    packageId: PACKAGE_ID,
    packageName: "Swimming Pool",
    materialName: "Cement",
    qty: 120,
    unit: "bag",
    rate: 410,
    value: 49200,
    neededBy: "2026-10-08",
    note: "For the deck",
    status: "pending",
    requestedByName: "Ravi Kumar",
    createdAt: "2026-10-01T06:30:00.000Z",
    approvedAt: null,
    orderedAt: null,
    deliveredAt: null,
    rejectedReason: null,
    ...over,
  };
}

function list(query = "", projectId = PROJECT_ID) {
  return GET(new Request(`http://localhost/api/mobile/v1/projects/${projectId}/stock-requests${query}`), {
    params: Promise.resolve({ projectId }),
  });
}

describe("GET /api/mobile/v1/projects/:projectId/stock-requests", () => {
  beforeEach(() => {
    h.getStockRequestsPage.mockReset();
    h.getStockRequestsPage.mockResolvedValue({ rows: [dto()], total: 1, page: 1, pageSize: 25 });
    h.countPendingRequestsByProject.mockReset();
    h.countPendingRequestsByProject.mockResolvedValue({ [PROJECT_ID]: 3 });
    vi.mocked(service.availableTransitions).mockClear();
    vi.mocked(service.isDeadlineAtRisk).mockClear();
  });

  it.each(["admin", "site"] as const)("returns the first page for %s (200, no-store)", async (role) => {
    const session = sessionAs(role);
    h.requireRole.mockResolvedValue(session);

    const res = await list();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.role).toBe(role);
    expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["admin", "site"]);
    expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
    expect(h.getStockRequestsPage).toHaveBeenCalledExactlyOnceWith(
      session,
      PROJECT_ID,
      { status: undefined, packageId: undefined },
      { page: 1, pageSize: 25 }
    );
    expect(h.countPendingRequestsByProject).toHaveBeenCalledExactlyOnceWith(session, [PROJECT_ID]);
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await list();

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.getStockRequestsPage).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await list();

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.getStockRequestsPage).not.toHaveBeenCalled();
  });

  it("returns 403 for a client and never reads a request", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin, site"));

    const res = await list();

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getStockRequestsPage).not.toHaveBeenCalled();
    expect(h.countPendingRequestsByProject).not.toHaveBeenCalled();
  });

  it("returns 404 for a project id that is not a uuid, before any data read", async () => {
    const res = await list("", "not-a-uuid");

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getStockRequestsPage).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no access to the project", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await list();

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.getStockRequestsPage).not.toHaveBeenCalled();
  });

  it.each(["pending", "approved", "ordered", "delivered", "rejected"])(
    "passes status=%s to the query",
    async (status) => {
      await list(`?status=${status}`);

      expect(h.getStockRequestsPage.mock.calls[0]?.[2]).toEqual({ status, packageId: undefined });
    }
  );

  it.each(["cancelled", "PENDING", "", "pending,approved"])("returns 400 for status=%j", async (status) => {
    const res = await list(`?status=${encodeURIComponent(status)}`);

    await expectError(
      res,
      400,
      "VALIDATION",
      "status must be one of: pending, approved, ordered, delivered, rejected."
    );
    expect(h.getStockRequestsPage).not.toHaveBeenCalled();
  });

  it("passes packageId to the query, which stays scoped to this project", async () => {
    await list(`?packageId=${PACKAGE_ID}&status=ordered`);

    expect(h.getStockRequestsPage.mock.calls[0]?.[1]).toBe(PROJECT_ID);
    expect(h.getStockRequestsPage.mock.calls[0]?.[2]).toEqual({ status: "ordered", packageId: PACKAGE_ID });
  });

  it.each(["pool", "", "00000000-0000-4000-8000"])("returns 400 for packageId=%j", async (packageId) => {
    const res = await list(`?packageId=${encodeURIComponent(packageId)}`);

    await expectError(res, 400, "VALIDATION", "packageId must be a valid id.");
    expect(h.getStockRequestsPage).not.toHaveBeenCalled();
  });

  it("asks for the requested page, at the fixed page size", async () => {
    h.getStockRequestsPage.mockResolvedValue({ rows: [dto()], total: 60, page: 2, pageSize: 25 });

    const body = await (await list("?page=2")).json();

    expect(h.getStockRequestsPage.mock.calls[0]?.[3]).toEqual({ page: 2, pageSize: 25 });
    expect(body).toMatchObject({ total: 60, page: 2, pageSize: 25, hasMore: true });
  });

  it("ignores any pageSize the client sends", async () => {
    await list("?pageSize=100000");

    expect(h.getStockRequestsPage.mock.calls[0]?.[3]).toEqual({ page: 1, pageSize: 25 });
  });

  it.each(["0", "-1", "1.5", "abc", "", "1001", "99999999999999999999"])(
    "returns 400 for page=%j",
    async (page) => {
      const res = await list(`?page=${encodeURIComponent(page)}`);

      await expectError(res, 400, "VALIDATION", "page must be a whole number from 1 to 1000.");
      expect(h.getStockRequestsPage).not.toHaveBeenCalled();
    }
  );

  it("reports the page the query actually returned, and no more pages on the last one", async () => {
    // Asked past the end, the query falls back to the last page with rows.
    h.getStockRequestsPage.mockResolvedValue({ rows: [dto()], total: 30, page: 2, pageSize: 25 });

    const body = await (await list("?page=5")).json();

    expect(body).toMatchObject({ total: 30, page: 2, pageSize: 25, hasMore: false });
  });

  it("gives an admin the row's rate and value", async () => {
    h.requireRole.mockResolvedValue(sessionAs("admin"));

    const [row] = (await (await list()).json()).requests;

    expect(row.rate).toBe(410);
    expect(row.value).toBe(49200);
  });

  it("gives a site supervisor no rate or value keys at all", async () => {
    h.requireRole.mockResolvedValue(sessionAs("site"));
    // The site view already has no rate; even a row carrying one is not passed on.
    h.getStockRequestsPage.mockResolvedValue({ rows: [dto()], total: 1, page: 1, pageSize: 25 });

    const [row] = (await (await list()).json()).requests;

    expect(row).not.toHaveProperty("rate");
    expect(row).not.toHaveProperty("value");
    expect(row).not.toHaveProperty("billedOnBillId");
  });

  it("shapes each row for the list: the DTO's fields plus actions and atRisk", async () => {
    h.requireRole.mockResolvedValue(sessionAs("site"));
    const shown: Record<string, unknown> = dto();
    delete shown.rate;
    delete shown.value;

    const [row] = (await (await list()).json()).requests;

    expect(row).toEqual({ ...shown, actions: [], atRisk: true });
  });

  it.each([
    ["admin", "pending", ["approved", "rejected"]],
    ["admin", "approved", ["ordered"]],
    ["admin", "ordered", ["delivered"]],
    ["site", "pending", []],
    ["site", "ordered", ["delivered"]],
    ["admin", "delivered", []],
    ["admin", "rejected", []],
  ] as const)(
    "gives a %s a %s request the actions %j, from availableTransitions",
    async (role, status, expected) => {
      h.requireRole.mockResolvedValue(sessionAs(role));
      h.getStockRequestsPage.mockResolvedValue({ rows: [dto({ status })], total: 1, page: 1, pageSize: 25 });

      const [row] = (await (await list()).json()).requests;

      expect(row.actions).toEqual(expected);
      expect(service.availableTransitions).toHaveBeenCalledWith(status, role);
    }
  );

  it.each([
    ["pending, due tomorrow", "pending", "2026-10-08", true],
    ["pending, already overdue", "pending", "2026-10-01", true],
    ["pending, due in a fortnight", "pending", "2026-10-21", false],
    ["approved, due tomorrow", "approved", "2026-10-08", false],
    ["pending, no needed-by date", "pending", null, false],
  ] as const)(
    "marks a request %s as atRisk=%s, from isDeadlineAtRisk with India's today",
    async (_l, status, neededBy, expected) => {
      h.getStockRequestsPage.mockResolvedValue({
        rows: [dto({ status, neededBy })],
        total: 1,
        page: 1,
        pageSize: 25,
      });

      const [row] = (await (await list()).json()).requests;

      expect(row.atRisk).toBe(expected);
      expect(service.isDeadlineAtRisk).toHaveBeenCalledWith(status, neededBy, "2026-10-07");
    }
  );

  it("returns the project's pending count from countPendingRequestsByProject, not from the page", async () => {
    h.countPendingRequestsByProject.mockResolvedValue({ [PROJECT_ID]: 7 });
    h.getStockRequestsPage.mockResolvedValue({
      rows: [dto({ status: "delivered" })],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    const body = await (await list("?status=delivered")).json();

    expect(body.pendingCount).toBe(7);
  });

  it("returns an empty list, a zero pending count and no more pages for a project with no requests", async () => {
    h.getStockRequestsPage.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
    h.countPendingRequestsByProject.mockResolvedValue({});

    const body = await (await list()).json();

    expect(body).toEqual({
      role: "site",
      requests: [],
      total: 0,
      pendingCount: 0,
      page: 1,
      pageSize: 25,
      hasMore: false,
    });
  });

  it("returns 500 with a reference for a query error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.getStockRequestsPage.mockRejectedValue(new Error('relation "v_stock_request_site" does not exist'));

    const res = await list();

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
