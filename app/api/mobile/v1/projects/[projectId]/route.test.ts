import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: it guards with requireSession() and
 * requireProjectAccess(), calls the existing query functions, and returns
 * their data — trimmed to the dashboard's preview lengths, otherwise as the
 * queries shaped it for the role. Role shaping itself is each query's job and
 * is tested where it lives; these fixtures only stand in for it.
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
    getProjectHeader: vi.fn(),
    getClientBillingStats: vi.fn(),
    getSiteStockStats: vi.fn(),
    getPackagesForProject: vi.fn(),
    getUpdatesForProject: vi.fn(),
    getStockRequestsForProject: vi.fn(),
    getApprovalsForProject: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
// Bearer-first (lib/mobile/api.ts): the route reads the header before the
// session; the token itself is verified by requireSession(), mocked below.
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
vi.mock("@/features/projects/queries", () => ({
  getProjectHeader: h.getProjectHeader,
  getClientBillingStats: h.getClientBillingStats,
  getSiteStockStats: h.getSiteStockStats,
}));
vi.mock("@/features/packages/queries", () => ({ getPackagesForProject: h.getPackagesForProject }));
vi.mock("@/features/updates/queries", () => ({ getUpdatesForProject: h.getUpdatesForProject }));
vi.mock("@/features/stock/queries", () => ({ getStockRequestsForProject: h.getStockRequestsForProject }));
vi.mock("@/features/approvals/queries", () => ({ getApprovalsForProject: h.getApprovalsForProject }));

const { GET } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000b1";

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

function call(projectId = PROJECT_ID) {
  return GET(new Request(`http://localhost/api/mobile/v1/projects/${projectId}`), {
    params: Promise.resolve({ projectId }),
  });
}

// What the route returns: the header minus rateVisibility (admin card, D55).
const HEADER_OUT = {
  id: PROJECT_ID,
  name: "BHEL Nagnar Club House",
  client: "BHEL",
  location: "Nagnar",
  start: "2026-09-01",
  status: "Active",
  progressPct: 42,
};
const HEADER = { ...HEADER_OUT, rateVisibility: "hidden" };

const pkg = {
  id: "p1",
  seqNo: 1,
  name: "Civil",
  lead: "Suresh",
  status: "in_progress",
  statusLabel: "In progress",
  progressPct: 40,
};
const PACKAGES = {
  admin: {
    role: "money",
    packages: [
      {
        ...pkg,
        role: "money",
        allocated: 100,
        internal: 80,
        committed: 40,
        remaining: 40,
        usedPct: 50,
        isOverBudget: false,
      },
    ],
    totals: { allocated: 100, internal: 80, committed: 40, remaining: 40 },
  },
  client: {
    role: "client",
    packages: [{ ...pkg, role: "client", contractValue: 120 }],
    totals: { allocated: 120 },
  },
  site: { role: "site", packages: [{ ...pkg, role: "site", openRequests: 1, phaseCount: 3 }] },
};

const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
const UPDATES = many(6, "u");
const APPROVALS = many(7, "a");
// Admin's rows carry rate/value; site's are the money-free view's (null).
const REQUESTS = {
  admin: many(8, "r").map((r) => ({ ...r, rate: 10, value: 100 })),
  site: many(8, "r").map((r) => ({ ...r, rate: null, value: null })),
};
const CLIENT_STATS = { billedNet: 500, paidNet: 200, billsSubmitted: 1, approvalsPending: 2 };
const SITE_STATS = { pendingRequests: 3, toReceive: 1 };

beforeEach(() => {
  h.bearerToken = "mobile-token";
  for (const fn of Object.values(h)) if (typeof fn === "function" && "mockReset" in fn) fn.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.getProjectHeader.mockResolvedValue(HEADER);
  h.getUpdatesForProject.mockResolvedValue({ items: UPDATES, nextCursor: "next" });
  h.getApprovalsForProject.mockResolvedValue(APPROVALS);
  h.getClientBillingStats.mockResolvedValue(CLIENT_STATS);
  h.getSiteStockStats.mockResolvedValue(SITE_STATS);
});

function setRole(role: Session["role"]) {
  const session = sessionAs(role);
  h.requireSession.mockResolvedValue(session);
  h.getPackagesForProject.mockResolvedValue(PACKAGES[role]);
  if (role !== "client") h.getStockRequestsForProject.mockResolvedValue(REQUESTS[role]);
  return session;
}

/** Calls every role makes, with the session and project they were given. */
function expectCommonCalls(session: Session) {
  expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
  expect(h.getProjectHeader).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
  expect(h.getPackagesForProject).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
  expect(h.getUpdatesForProject).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
  expect(h.getApprovalsForProject).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID, {
    status: "pending",
  });
}

describe("GET /api/mobile/v1/projects/:projectId", () => {
  it("returns JSON 401 when there is no session", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call();

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Your session expired. Please sign in again.",
    });
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getProjectHeader).not.toHaveBeenCalled();
  });

  it("returns 200 for admin: admin-shaped data, totals as stats, pending requests with money", async () => {
    const session = setRole("admin");

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expectCommonCalls(session);
    expect(h.getStockRequestsForProject).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID, {
      status: "pending",
    });
    expect(h.getClientBillingStats).not.toHaveBeenCalled();
    expect(h.getSiteStockStats).not.toHaveBeenCalled();
    expect(body).toEqual({
      role: "admin",
      header: HEADER_OUT,
      packages: PACKAGES.admin.packages,
      latestUpdates: UPDATES.slice(0, 3),
      pendingApprovals: APPROVALS.slice(0, 5),
      pendingRequests: REQUESTS.admin.slice(0, 5),
      stats: PACKAGES.admin.totals,
    });
  });

  it("returns 200 for site: site-shaped packages, money-free requests, site stock stats", async () => {
    const session = setRole("site");

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expectCommonCalls(session);
    expect(h.getSiteStockStats).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
    expect(h.getClientBillingStats).not.toHaveBeenCalled();
    expect(body).toEqual({
      role: "site",
      header: HEADER_OUT,
      packages: PACKAGES.site.packages,
      latestUpdates: UPDATES.slice(0, 3),
      pendingApprovals: APPROVALS.slice(0, 5),
      pendingRequests: REQUESTS.site.slice(0, 5),
      stats: SITE_STATS,
    });
    expect(
      body.pendingRequests.every(
        (r: { rate: unknown; value: unknown }) => r.rate === null && r.value === null
      )
    ).toBe(true);
  });

  it("returns 200 for client: no stock requests fetched or returned, client billing stats", async () => {
    const session = setRole("client");

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expectCommonCalls(session);
    expect(h.getStockRequestsForProject).not.toHaveBeenCalled();
    expect(h.getClientBillingStats).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
    expect(h.getSiteStockStats).not.toHaveBeenCalled();
    expect(body).toEqual({
      role: "client",
      header: HEADER_OUT,
      packages: PACKAGES.client.packages,
      latestUpdates: UPDATES.slice(0, 3),
      pendingApprovals: APPROVALS.slice(0, 5),
      pendingRequests: null,
      stats: CLIENT_STATS,
    });
  });

  it("returns JSON 403 when the user is not a member of the project", async () => {
    setRole("site");
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await call();

    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "You don't have permission to do that.",
    });
    expect(h.getProjectHeader).not.toHaveBeenCalled();
    expect(h.getPackagesForProject).not.toHaveBeenCalled();
  });

  it("returns JSON 404 when the project does not exist", async () => {
    setRole("admin");
    h.getProjectHeader.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "NOT_FOUND", message: "That record no longer exists." });
    expect(h.getPackagesForProject).not.toHaveBeenCalled();
  });

  it("returns JSON 404 for an id that is not a uuid, without touching the database", async () => {
    setRole("admin");

    const res = await call("not-a-uuid");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND", message: "That record no longer exists." });
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getProjectHeader).not.toHaveBeenCalled();
  });

  it("returns JSON 500 with the mapped message, never the raw database error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setRole("site");
    h.getPackagesForProject.mockRejectedValue(new Error('relation "v_package_site" does not exist'));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.error).toBe("INTERNAL");
    expect(body.message).toMatch(/^Something went wrong\. Reference: /);
    expect(JSON.stringify(body)).not.toContain("v_package_site");
    consoleError.mockRestore();
  });
});

describe("Bearer only (Batch 18)", () => {
  it("returns 401 { error, message } with no Authorization header, before the session or any query", async () => {
    h.bearerToken = null;

    const res = await call();

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Your session expired. Please sign in again.",
    });
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.getProjectHeader).not.toHaveBeenCalled();
  });

  it("refuses a browser cookie session that carries no Bearer header — even one requireSession would accept", async () => {
    // A cookie session resolves in requireSession(); the route never asks.
    h.bearerToken = null;
    h.requireSession.mockResolvedValue({
      userId: "00000000-0000-4000-8000-0000000000d1",
      orgId: "00000000-0000-4000-8000-0000000000a0",
      role: "admin",
      fullName: "Cookie User",
      email: null,
      impersonating: null,
    });

    const res = await call();

    expect(res.status).toBe(401);
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.getProjectHeader).not.toHaveBeenCalled();
  });

  it("returns 401 { error, message } for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Your session expired. Please sign in again.",
    });
    expect(h.getProjectHeader).not.toHaveBeenCalled();
  });

  it("returns errors as exactly { error, message } — no stack, SQL or token", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.requireSession.mockRejectedValue(
      new Error("connection to 10.0.0.5 failed: password authentication failed")
    );

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(Object.keys(body).sort()).toEqual(["error", "message"]);
    expect(JSON.stringify(body)).not.toMatch(/10\.0\.0\.5|password|mobile-token|stack/i);
    consoleError.mockRestore();
  });
});
