import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required (a cookie session alone never
 * authorizes it), admin/site only (client → 403, never an empty list), `q`
 * normalised by the web's own normalizeInventorySearch (real), `projectId`
 * checked and access-checked, a fixed page size, the shared
 * getBusinessInventory called with the session, items reshaped to what the
 * web table shows with money for admin only, no-store, errors mapped. What
 * each role can see is getBusinessInventory's own scoping, tested in
 * features/inventory/queries.test.ts.
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
    getBusinessInventory: vi.fn(),
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
vi.mock("@/features/inventory/queries", () => ({ getBusinessInventory: h.getBusinessInventory }));

const { GET } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

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

/** An item exactly as getBusinessInventory returns it (admin-shaped). */
const ITEM = {
  id: "00000000-0000-4000-8000-000000000601",
  projectId: PROJECT_ID,
  projectName: "Tile House",
  name: "Cement OPC 53",
  category: "Binders",
  sku: "CEM-53",
  unit: "bag",
  qtyOnHand: 4,
  reorderLevel: 10,
  unitCost: 410,
  stockValue: 1640,
  location: "Store A",
  status: "low",
};

const STATS = { totalItems: 3, totalValue: 98000, lowCount: 1, criticalCount: 1 };

function list(query = "") {
  return GET(new Request(`http://localhost/api/mobile/v1/inventory${query}`));
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
  h.requireRole.mockResolvedValue(sessionAs("admin"));
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.getBusinessInventory.mockReset();
  h.getBusinessInventory.mockResolvedValue({
    items: { rows: [ITEM], total: 1, page: 1, pageSize: 25 },
    stats: STATS,
  });
});

describe("GET /api/mobile/v1/inventory", () => {
  it.each(["admin", "site"] as const)(
    "returns the first page for %s, with its role (200, no-store)",
    async (role) => {
      const session = sessionAs(role);
      h.requireRole.mockResolvedValue(session);

      const res = await list();

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect((await res.json()).role).toBe(role);
      expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["admin", "site"]);
      expect(h.getBusinessInventory).toHaveBeenCalledExactlyOnceWith(
        session,
        { projectId: undefined, search: undefined },
        { page: 1, pageSize: 25 }
      );
    }
  );

  it("gives an admin exactly the web table's fields, with Value and Total Value", async () => {
    const body = await (await list()).json();

    expect(body).toEqual({
      role: "admin",
      stats: { totalItems: 3, totalValue: 98000, lowCount: 1, criticalCount: 1 },
      items: [
        {
          id: ITEM.id,
          name: "Cement OPC 53",
          category: "Binders",
          projectId: PROJECT_ID,
          projectName: "Tile House",
          qtyOnHand: 4,
          reorderLevel: 10,
          unit: "bag",
          stockValue: 1640,
          location: "Store A",
          status: "low",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      hasMore: false,
    });
  });

  it("gives site no money keys at all — no Value, no Total Value, no unit cost", async () => {
    h.requireRole.mockResolvedValue(sessionAs("site"));

    const body = await (await list()).json();

    expect(body.stats).not.toHaveProperty("totalValue");
    expect(body.items[0]).not.toHaveProperty("stockValue");
    expect(body.items[0]).not.toHaveProperty("unitCost");
  });

  it("never sends the SKU or unit cost, which the web table does not show", async () => {
    const body = await (await list()).json();

    expect(body.items[0]).not.toHaveProperty("sku");
    expect(body.items[0]).not.toHaveProperty("unitCost");
  });

  it("returns an empty list and zero stats for an empty inventory", async () => {
    h.getBusinessInventory.mockResolvedValue({
      items: { rows: [], total: 0, page: 1, pageSize: 25 },
      stats: { totalItems: 0, totalValue: 0, lowCount: 0, criticalCount: 0 },
    });

    const body = await (await list()).json();

    expect(body.items).toEqual([]);
    expect(body).toMatchObject({
      total: 0,
      hasMore: false,
      stats: { totalItems: 0, lowCount: 0, criticalCount: 0 },
    });
  });

  it("passes the search, trimmed, as the web does", async () => {
    await list("?q=%20%20cement%20%20");

    expect(h.getBusinessInventory.mock.calls[0]?.[1]).toEqual({ projectId: undefined, search: "cement" });
  });

  it("treats a blank search as no search", async () => {
    await list("?q=%20%20%20");

    expect(h.getBusinessInventory.mock.calls[0]?.[1]).toEqual({ projectId: undefined, search: undefined });
  });

  it("caps a long search at the web's 80 characters", async () => {
    await list(`?q=${"x".repeat(200)}`);

    expect((h.getBusinessInventory.mock.calls[0]?.[1] as { search: string }).search).toHaveLength(80);
  });

  it("filters by a project the caller has access to — access checked first", async () => {
    const session = sessionAs("site");
    h.requireRole.mockResolvedValue(session);

    await list(`?projectId=${PROJECT_ID}&q=cement`);

    expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
    expect(h.getBusinessInventory.mock.calls[0]?.[1]).toEqual({ projectId: PROJECT_ID, search: "cement" });
  });

  it("refuses a project filter the caller has no access to (403), reading nothing", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await list(`?projectId=${PROJECT_ID}`);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.getBusinessInventory).not.toHaveBeenCalled();
  });

  it.each(["tile-house", "", "00000000-0000-4000-8000"])(
    "returns 400 for projectId=%j",
    async (projectId) => {
      const res = await list(`?projectId=${encodeURIComponent(projectId)}`);

      await expectError(res, 400, "VALIDATION", "projectId must be a valid id.");
      expect(h.getBusinessInventory).not.toHaveBeenCalled();
    }
  );

  it("asks for the requested page at the fixed size, ignoring any pageSize sent", async () => {
    h.getBusinessInventory.mockResolvedValue({
      items: { rows: [ITEM], total: 60, page: 2, pageSize: 25 },
      stats: STATS,
    });

    const body = await (await list("?page=2&pageSize=500")).json();

    expect(h.getBusinessInventory.mock.calls[0]?.[2]).toEqual({ page: 2, pageSize: 25 });
    expect(body).toMatchObject({ total: 60, page: 2, pageSize: 25, hasMore: true });
  });

  it.each(["0", "-1", "1.5", "abc", "", "1001"])("returns 400 for page=%j", async (page) => {
    const res = await list(`?page=${encodeURIComponent(page)}`);

    await expectError(res, 400, "VALIDATION", "page must be a whole number from 1 to 1000.");
    expect(h.getBusinessInventory).not.toHaveBeenCalled();
  });

  it("ignores any role or user the request names — only the session counts", async () => {
    const session = sessionAs("site");
    h.requireRole.mockResolvedValue(session);

    const body = await (await list("?role=admin&userId=x")).json();

    expect(h.getBusinessInventory.mock.calls[0]?.[0]).toBe(session);
    expect(body.role).toBe("site");
    expect(body.items[0]).not.toHaveProperty("stockValue");
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await list();

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.getBusinessInventory).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await list();

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.getBusinessInventory).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, never an empty list", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin, site"));

    const res = await list();

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.getBusinessInventory).not.toHaveBeenCalled();
  });

  it("returns 500 with a reference for a query error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.getBusinessInventory.mockRejectedValue(new Error('relation "v_inventory_site" does not exist'));

    const res = await list();

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    consoleError.mockRestore();
  });
});
