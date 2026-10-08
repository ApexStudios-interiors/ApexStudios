import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: session + project-access guards, uuid checks,
 * the package-belongs-to-project check (for every role, admin included), the
 * existing query functions called and their data returned — trimmed to the
 * preview lengths, the schedule stripped of Gantt-only fields, otherwise as
 * the queries shaped it for the role. Role shaping itself is each query's job
 * and is tested where it lives; these fixtures only stand in for it.
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
    getPackageNavLists: vi.fn(),
    getPackageDetail: vi.fn(),
    getPhasesForPackage: vi.fn(),
    getScheduleForPackage: vi.fn(),
    getUpdatesForProject: vi.fn(),
    getStockRequestsPage: vi.fn(),
    getOwnerOptions: vi.fn(),
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
vi.mock("@/features/packages/queries", () => ({
  getPackageNavLists: h.getPackageNavLists,
  getPackageDetail: h.getPackageDetail,
  getPhasesForPackage: h.getPhasesForPackage,
}));
vi.mock("@/features/schedule/queries", () => ({ getScheduleForPackage: h.getScheduleForPackage }));
vi.mock("@/features/schedule/actions", () => ({ getOwnerOptions: h.getOwnerOptions }));
vi.mock("@/features/updates/queries", () => ({ getUpdatesForProject: h.getUpdatesForProject }));
vi.mock("@/features/stock/queries", () => ({ getStockRequestsPage: h.getStockRequestsPage }));

const { GET } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000b1";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000c1";
const OTHER_PACKAGE_ID = "00000000-0000-4000-8000-0000000000c2";

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

function call(projectId = PROJECT_ID, packageId = PACKAGE_ID) {
  return GET(new Request(`http://localhost/api/mobile/v1/projects/${projectId}/packages/${packageId}`), {
    params: Promise.resolve({ projectId, packageId }),
  });
}

const base = {
  id: PACKAGE_ID,
  seqNo: 1,
  name: "Civil",
  lead: "Suresh",
  status: "in_progress",
  statusLabel: "In progress",
  progressPct: 40,
};
const DETAIL = {
  admin: {
    ...base,
    role: "money",
    allocated: 100,
    internal: 80,
    committed: 40,
    remaining: 40,
    usedPct: 50,
    updatedAt: "2026-10-01T00:00:00Z",
  },
  client: { ...base, role: "client", contractValue: 120 },
  site: { ...base, role: "site" },
};
const PHASES = {
  admin: {
    role: "money",
    phases: [
      {
        id: "ph1",
        seqNo: 1,
        name: "Foundation",
        role: "money",
        allocated: 50,
        internal: 40,
        committed: 20,
        remaining: 20,
      },
    ],
    totals: { allocated: 50, internal: 40, committed: 20 },
  },
  client: {
    role: "client",
    phases: [
      { id: "ph1", seqNo: 1, name: "Foundation", role: "client", contractValue: 60, isComplete: false },
    ],
    totals: { allocated: 60 },
  },
  site: { role: "site", phases: [{ id: "ph1", seqNo: 1, name: "Foundation", role: "site", requests: 2 }] },
};

const task = {
  id: "t1",
  name: "Excavation",
  ownerName: "Ravi",
  startDate: "2026-09-01",
  durationWeeks: 2,
  endDate: "2026-09-14",
  progressPct: 60,
  late: false,
  note: null,
};
// The query's own shape, Gantt fields included.
const SCHEDULE = {
  packageId: PACKAGE_ID,
  packageName: "Civil",
  seqNo: 1,
  projectStart: "2026-09-01",
  phases: [
    {
      id: "ph1",
      seqNo: 1,
      name: "Foundation",
      progressPct: 60,
      tasks: [{ ...task, weekIndexStart: 0, weekIndexEnd: 1 }],
    },
  ],
  taskCount: 1,
  progressPct: 60,
  viewport: { from: 0, to: 12 },
  monthHeaders: [{ label: "Sep 2026", span: 4 }],
};
// What the route returns: the same values, Gantt fields removed.
const SCHEDULE_OUT = {
  packageId: PACKAGE_ID,
  packageName: "Civil",
  seqNo: 1,
  projectStart: "2026-09-01",
  progressPct: 60,
  taskCount: 1,
  phases: [{ id: "ph1", seqNo: 1, name: "Foundation", progressPct: 60, tasks: [task] }],
};

const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
const UPDATES = many(7, "u");
const REQUESTS = {
  admin: many(8, "r").map((r) => ({ ...r, rate: 10, value: 100 })),
  site: many(8, "r").map((r) => ({ ...r, rate: null, value: null })),
};

beforeEach(() => {
  h.bearerToken = "mobile-token";
  for (const fn of Object.values(h)) if (typeof fn === "function" && "mockReset" in fn) fn.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.getScheduleForPackage.mockResolvedValue(SCHEDULE);
  // As the query does: at most `limit` updates (20 by default), newest first.
  h.getUpdatesForProject.mockImplementation(async (_s: Session, _p: string, opts: { limit?: number }) => ({
    items: UPDATES.slice(0, opts.limit ?? 20),
    nextCursor: "next",
  }));
});

/** getOwnerOptions' own shape — the web Add Task dialog's Owner choices. */
const OWNERS = [
  { id: "00000000-0000-4000-8000-0000000000d7", name: "Anita Rao" },
  { id: "00000000-0000-4000-8000-0000000000d8", name: "Ravi Kumar" },
];

function setRole(role: Session["role"]) {
  const session = sessionAs(role);
  h.requireSession.mockResolvedValue(session);
  h.getPackageNavLists.mockResolvedValue({
    [PROJECT_ID]: [
      { id: OTHER_PACKAGE_ID, name: "Civil" },
      { id: PACKAGE_ID, name: "Swimming Pool" },
    ],
  });
  h.getPackageDetail.mockResolvedValue(DETAIL[role]);
  h.getPhasesForPackage.mockResolvedValue(PHASES[role]);
  // As the paged query does: page 1 of the role's ordered rows, pageSize long.
  if (role !== "client") {
    const rows = REQUESTS[role];
    h.getStockRequestsPage.mockImplementation(
      async (_s: Session, _p: string, _o: unknown, req: { page: number; pageSize: number }) => ({
        rows: rows.slice(0, req.pageSize),
        total: rows.length,
        page: req.page,
        pageSize: req.pageSize,
      })
    );
  }
  h.getOwnerOptions.mockReset();
  h.getOwnerOptions.mockResolvedValue(OWNERS);
  return session;
}

/** Calls every role makes, with the session and ids they were given. */
function expectCommonCalls(session: Session) {
  expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
  expect(h.getPackageNavLists).toHaveBeenCalledExactlyOnceWith(session, [PROJECT_ID]);
  expect(h.getPackageDetail).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID, PACKAGE_ID);
  expect(h.getPhasesForPackage).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID, PACKAGE_ID);
  expect(h.getScheduleForPackage).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID, PACKAGE_ID);
  // Only the five updates shown are read.
  expect(h.getUpdatesForProject).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID, {
    packageId: PACKAGE_ID,
    limit: 5,
  });
}

function expectNoPackageReads() {
  expect(h.getPackageDetail).not.toHaveBeenCalled();
  expect(h.getPhasesForPackage).not.toHaveBeenCalled();
  expect(h.getScheduleForPackage).not.toHaveBeenCalled();
  expect(h.getUpdatesForProject).not.toHaveBeenCalled();
  expect(h.getStockRequestsPage).not.toHaveBeenCalled();
}

describe("GET /api/mobile/v1/projects/:projectId/packages/:packageId", () => {
  it("returns 200 for admin: admin-shaped detail and phases, schedule, updates, money-bearing requests", async () => {
    const session = setRole("admin");

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expectCommonCalls(session);
    // Only the five pending requests shown are read: page 1 of the same query.
    expect(h.getStockRequestsPage).toHaveBeenCalledExactlyOnceWith(
      session,
      PROJECT_ID,
      { status: "pending", packageId: PACKAGE_ID },
      { page: 1, pageSize: 5 }
    );
    expect(body).toEqual({
      role: "admin",
      package: DETAIL.admin,
      phases: PHASES.admin.phases,
      phaseTotals: PHASES.admin.totals,
      schedule: SCHEDULE_OUT,
      latestUpdates: UPDATES.slice(0, 5),
      pendingRequests: REQUESTS.admin.slice(0, 5),
      ownerOptions: OWNERS,
    });
    expect(h.getOwnerOptions).toHaveBeenCalledOnce();
  });

  it("returns 200 for site: site-shaped detail and phases, no phase totals, money-free requests", async () => {
    const session = setRole("site");

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expectCommonCalls(session);
    // Only the five pending requests shown are read: page 1 of the same query.
    expect(h.getStockRequestsPage).toHaveBeenCalledExactlyOnceWith(
      session,
      PROJECT_ID,
      { status: "pending", packageId: PACKAGE_ID },
      { page: 1, pageSize: 5 }
    );
    expect(body).toEqual({
      role: "site",
      package: DETAIL.site,
      phases: PHASES.site.phases,
      phaseTotals: null,
      schedule: SCHEDULE_OUT,
      latestUpdates: UPDATES.slice(0, 5),
      pendingRequests: REQUESTS.site.slice(0, 5),
      ownerOptions: OWNERS,
    });
    expect(h.getOwnerOptions).toHaveBeenCalledOnce();
    expect(
      body.pendingRequests.every(
        (r: { rate: unknown; value: unknown }) => r.rate === null && r.value === null
      )
    ).toBe(true);
  });

  it("returns 200 for client: client-shaped detail and phases, and no stock requests fetched or returned", async () => {
    const session = setRole("client");

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expectCommonCalls(session);
    expect(h.getStockRequestsPage).not.toHaveBeenCalled();
    expect(body).toEqual({
      role: "client",
      package: DETAIL.client,
      phases: PHASES.client.phases,
      phaseTotals: PHASES.client.totals,
      schedule: SCHEDULE_OUT,
      latestUpdates: UPDATES.slice(0, 5),
      pendingRequests: null,
      // A client never adds a task, so never gets the staff list.
      ownerOptions: null,
    });
    expect(h.getOwnerOptions).not.toHaveBeenCalled();
  });

  it("never sends the Gantt-only schedule fields", async () => {
    setRole("site");

    const body = await (await call()).json();

    expect(body.schedule).not.toHaveProperty("viewport");
    expect(body.schedule).not.toHaveProperty("monthHeaders");
    expect(body.schedule.phases[0].tasks[0]).not.toHaveProperty("weekIndexStart");
    expect(body.schedule.phases[0].tasks[0]).not.toHaveProperty("weekIndexEnd");
  });

  it("returns schedule null when the query has none (project has no start date)", async () => {
    setRole("admin");
    h.getScheduleForPackage.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(200);
    expect((await res.json()).schedule).toBeNull();
  });

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
    expect(h.getPackageNavLists).not.toHaveBeenCalled();
  });

  it("returns JSON 403 when the user has no access to the project", async () => {
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
    expect(h.getPackageNavLists).not.toHaveBeenCalled();
    expectNoPackageReads();
  });

  it("returns JSON 404 for a project id that is not a uuid, without touching the database", async () => {
    setRole("admin");

    const res = await call("not-a-uuid", PACKAGE_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND", message: "That record no longer exists." });
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getPackageNavLists).not.toHaveBeenCalled();
  });

  it("returns JSON 404 for a package id that is not a uuid, without touching the database", async () => {
    setRole("admin");

    const res = await call(PROJECT_ID, "not-a-uuid");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND", message: "That record no longer exists." });
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getPackageNavLists).not.toHaveBeenCalled();
  });

  it.each(["admin", "site", "client"] as const)(
    "returns JSON 404 when the package belongs to another project (%s)",
    async (role) => {
      setRole(role);
      // The project's packages do not include the requested one.
      h.getPackageNavLists.mockResolvedValue({ [PROJECT_ID]: [{ id: OTHER_PACKAGE_ID, name: "Civil" }] });

      const res = await call();

      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "NOT_FOUND", message: "That record no longer exists." });
      // Nothing about the foreign package is read, admin included.
      expectNoPackageReads();
    }
  );

  it("returns JSON 404 when the project has no packages at all (nothing listed for it)", async () => {
    setRole("admin");
    h.getPackageNavLists.mockResolvedValue({});

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND", message: "That record no longer exists." });
    expectNoPackageReads();
  });

  it("returns JSON 404 when the package detail is missing", async () => {
    setRole("site");
    h.getPackageDetail.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND", message: "That record no longer exists." });
    expect(h.getPhasesForPackage).not.toHaveBeenCalled();
    expect(h.getStockRequestsPage).not.toHaveBeenCalled();
  });

  it("returns JSON 500 with the mapped message, never the raw database error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setRole("admin");
    h.getPhasesForPackage.mockRejectedValue(new Error('relation "v_package_rollup" does not exist'));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.error).toBe("INTERNAL");
    expect(body.message).toMatch(/^Something went wrong\. Reference: /);
    expect(JSON.stringify(body)).not.toContain("v_package_rollup");
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
    expect(h.getPackageNavLists).not.toHaveBeenCalled();
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
    expect(h.getPackageNavLists).not.toHaveBeenCalled();
  });

  it("returns 401 { error, message } for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Your session expired. Please sign in again.",
    });
    expect(h.getPackageNavLists).not.toHaveBeenCalled();
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
