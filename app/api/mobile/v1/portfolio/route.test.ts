import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import type { Portfolio } from "@/features/projects/queries";

/**
 * The route's own contract: requireSession() guards it, getPortfolio() is
 * called with that session and its result is returned as-is (role shaping is
 * getPortfolio's job, tested where it lives), and every response is JSON with
 * no-store. How a bearer token becomes a session is lib/auth/session.test.ts's
 * job.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireSession: vi.fn<() => Promise<Session>>(),
    getPortfolio: vi.fn<(session: Session) => Promise<Portfolio>>(),
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
  requireRole: vi.fn(),
}));
vi.mock("@/features/projects/queries", () => ({ getPortfolio: h.getPortfolio }));

const { GET } = await import("./route");

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

const card = {
  id: "00000000-0000-4000-8000-0000000000b1",
  code: "BHEL-NCH",
  name: "BHEL Nagnar Club House",
  client: "BHEL",
  location: "Nagnar",
  status: "Active",
  progressPct: 42,
  start: "2026-09-01",
  packageCount: 3,
};

const PORTFOLIO: Record<Session["role"], Portfolio> = {
  admin: {
    role: "money",
    stats: { totalAllocated: "100000", totalInternal: "80000", committed: "40000", activeProjects: 1 },
    projects: [{ ...card, headlineAmount: "100000", budgetUsedPct: 50 }],
  },
  client: {
    role: "client",
    stats: { totalContractValue: "120000", activeProjects: 1, awaitingApproval: 2 },
    projects: [{ ...card, headlineAmount: "120000", budgetUsedPct: null }],
  },
  site: {
    role: "site",
    stats: { activeProjects: 1, packagesInProgress: 2, pendingRequests: 1 },
    projects: [{ ...card, headlineAmount: null, budgetUsedPct: null }],
  },
};

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireSession.mockReset();
  h.getPortfolio.mockReset();
});

describe("GET /api/mobile/v1/portfolio", () => {
  it("returns JSON 401 when there is no session", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await GET();

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Your session expired. Please sign in again.",
    });
    expect(h.getPortfolio).not.toHaveBeenCalled();
  });

  it.each(["admin", "site", "client"] as const)(
    "returns 200 for %s: the session's role on top, getPortfolio's result unchanged, no-store",
    async (role) => {
      const session = sessionAs(role);
      h.requireSession.mockResolvedValue(session);
      h.getPortfolio.mockResolvedValue(PORTFOLIO[role]);

      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      // The authenticated role, verbatim — for admin that is "admin", never
      // getPortfolio's "money" variant tag.
      expect(body.role).toBe(role);
      // And exactly what getPortfolio returned for this session — nothing
      // added, nothing removed.
      expect(body).toEqual({ role, portfolio: PORTFOLIO[role] });
      expect(h.getPortfolio).toHaveBeenCalledExactlyOnceWith(session);
    }
  );

  it("returns JSON 403 on a forbidden error", async () => {
    h.requireSession.mockResolvedValue(sessionAs("site"));
    h.getPortfolio.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: not a member"));

    const res = await GET();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "You don't have permission to do that.",
    });
  });

  it("returns JSON 500 with the mapped message, never the raw database error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.requireSession.mockResolvedValue(sessionAs("client"));
    h.getPortfolio.mockRejectedValue(new Error('relation "v_client_name" does not exist'));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.error).toBe("INTERNAL");
    expect(body.message).toMatch(/^Something went wrong\. Reference: /);
    expect(JSON.stringify(body)).not.toContain("v_client_name");
    consoleError.mockRestore();
  });
});

describe("Bearer only (Batch 18)", () => {
  it("returns 401 { error, message } with no Authorization header, before the session or any query", async () => {
    h.bearerToken = null;

    const res = await GET();

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Your session expired. Please sign in again.",
    });
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.getPortfolio).not.toHaveBeenCalled();
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

    const res = await GET();

    expect(res.status).toBe(401);
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.getPortfolio).not.toHaveBeenCalled();
  });

  it("returns 401 { error, message } for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Your session expired. Please sign in again.",
    });
    expect(h.getPortfolio).not.toHaveBeenCalled();
  });

  it("returns errors as exactly { error, message } — no stack, SQL or token", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.requireSession.mockRejectedValue(
      new Error("connection to 10.0.0.5 failed: password authentication failed")
    );

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(Object.keys(body).sort()).toEqual(["error", "message"]);
    expect(JSON.stringify(body)).not.toMatch(/10\.0\.0\.5|password|mobile-token|stack/i);
    consoleError.mockRestore();
  });
});
