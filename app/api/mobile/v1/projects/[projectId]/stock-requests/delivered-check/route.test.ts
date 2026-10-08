import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * GET …/stock-requests/delivered-check — Bearer first, admin/site (client
 * 403), project access, the URL's project and the query's three fields
 * handed to the web dialog's own hasDeliveredDuplicate (mocked; its rule is
 * isDuplicateOfDelivered, tested in features/stock/service.test.ts), and the
 * web's own DUPLICATE_DELIVERED_WARNING (real) returned when it matches.
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
    hasDeliveredDuplicate: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
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
vi.mock("@/features/stock/actions", () => ({ hasDeliveredDuplicate: h.hasDeliveredDuplicate }));

const { GET } = await import("./route");
const { DUPLICATE_DELIVERED_WARNING } = await import("@/features/stock/service");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const QUERY = "?materialName=Cement%20OPC%2053&qty=100&neededBy=2026-10-20";

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

function get(search = QUERY, projectId = PROJECT_ID) {
  return GET(
    new Request(
      `http://localhost/api/mobile/v1/projects/${projectId}/stock-requests/delivered-check${search}`
    ),
    { params: Promise.resolve({ projectId }) }
  );
}

async function expectError(res: Response, status: number, error: string, message: string | RegExp) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(["error", "message"]);
  expect(body.error).toBe(error);
  if (typeof message === "string") expect(body.message).toBe(message);
  else expect(body.message).toMatch(message);
}

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireSession.mockReset();
  h.requireSession.mockResolvedValue(sessionAs("site"));
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.hasDeliveredDuplicate.mockReset();
  h.hasDeliveredDuplicate.mockResolvedValue(false);
});

describe("GET /api/mobile/v1/projects/:projectId/stock-requests/delivered-check", () => {
  it.each(["admin", "site"] as const)(
    "returns the web's own warning for %s when the helper finds a delivered duplicate (200, no-store)",
    async (role) => {
      const session = sessionAs(role);
      h.requireSession.mockResolvedValue(session);
      h.hasDeliveredDuplicate.mockResolvedValue(true);

      const res = await get();

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ warning: DUPLICATE_DELIVERED_WARNING });
      expect(DUPLICATE_DELIVERED_WARNING).toBe(
        "This order has already been delivered with the mentioned quantity and deadline date."
      );
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.hasDeliveredDuplicate).toHaveBeenCalledExactlyOnceWith({
        projectId: PROJECT_ID,
        materialName: "Cement OPC 53",
        qty: "100",
        neededBy: "2026-10-20",
      });
    }
  );

  it("returns { warning: null } when there is no delivered duplicate", async () => {
    expect(await (await get()).json()).toEqual({ warning: null });
  });

  it("hands missing fields over as empty — the helper's own schema answers no", async () => {
    await get("");

    expect(h.hasDeliveredDuplicate).toHaveBeenCalledExactlyOnceWith({
      projectId: PROJECT_ID,
      materialName: "",
      qty: "",
      neededBy: "",
    });
  });

  it("always checks the URL's project — a projectId in the query is ignored", async () => {
    await get(`${QUERY}&projectId=00000000-0000-4000-8000-0000000000c9`);

    expect(h.hasDeliveredDuplicate.mock.calls[0]?.[0]).toMatchObject({ projectId: PROJECT_ID });
  });

  it("returns 401 with no Bearer header, before the session is read", async () => {
    h.bearerToken = null;

    await expectError(await get(), 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.hasDeliveredDuplicate).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    await expectError(await get(), 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.hasDeliveredDuplicate).not.toHaveBeenCalled();
  });

  it("returns 403 for a client — no stock surface at all", async () => {
    h.requireSession.mockResolvedValue(sessionAs("client"));

    await expectError(await get(), 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.hasDeliveredDuplicate).not.toHaveBeenCalled();
  });

  it("returns 403 for a project the user cannot access, with no read", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    await expectError(await get(), 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.hasDeliveredDuplicate).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed project id, before any access check or read", async () => {
    await expectError(await get(QUERY, "not-a-uuid"), 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.hasDeliveredDuplicate).not.toHaveBeenCalled();
  });

  it("returns 500 with a reference for a query error, never the raw message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.hasDeliveredDuplicate.mockRejectedValue(new Error('relation "stock_requests" does not exist'));

    await expectError(await get(), 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    consoleError.mockRestore();
  });
});
