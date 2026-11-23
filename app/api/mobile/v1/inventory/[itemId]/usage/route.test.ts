import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required, admin and site (client → 403),
 * the item from the URL, only packageId / qty / note from the body (validated
 * by the web action's own recordUsageSchema), the shared recordUsageFor
 * called with the session, `{ id, qtyOnHand, reorderLevel, status }` back with
 * no money, and the RPC's refusals mapped. The helper is mocked; the RPC is
 * tested in tests/integration/stock-and-inventory-fixes.test.ts.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireRole: vi.fn(),
    recordUsageFor: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireRole: h.requireRole,
  requireProjectAccess: vi.fn(),
  requireSession: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getBearerToken: async () => h.bearerToken,
  createClient: vi.fn(),
}));
vi.mock("@/features/inventory/usage", () => ({ recordUsageFor: h.recordUsageFor }));

const { POST } = await import("./route");

const ITEM_ID = "00000000-0000-4000-8000-000000000601";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";

const SITE: Session = {
  userId: "00000000-0000-4000-8000-0000000000d5",
  orgId: "00000000-0000-4000-8000-0000000000a0",
  role: "site",
  fullName: "Test Site",
  email: null,
  impersonating: null,
};

const BODY = { packageId: PACKAGE_ID, qty: 4, note: "Screed" };

function call(body: unknown, itemId = ITEM_ID) {
  return POST(
    new Request(`http://localhost/api/mobile/v1/inventory/${itemId}/usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ itemId }) }
  );
}

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireRole.mockReset();
  h.requireRole.mockResolvedValue(SITE);
  h.recordUsageFor.mockReset();
  h.recordUsageFor.mockResolvedValue({
    id: ITEM_ID,
    projectId: "p",
    qtyOnHand: 6,
    reorderLevel: 10,
    status: "low",
  });
});

describe("POST /api/mobile/v1/inventory/:itemId/usage", () => {
  it("records usage for a site session and returns quantities only", async () => {
    const res = await call(BODY);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: ITEM_ID, qtyOnHand: 6, reorderLevel: 10, status: "low" });
    expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["admin", "site"]);
    expect(h.recordUsageFor).toHaveBeenCalledExactlyOnceWith(SITE, {
      itemId: ITEM_ID,
      packageId: PACKAGE_ID,
      qty: 4,
      note: "Screed",
    });
  });

  it("never lets the body choose the item", async () => {
    await call({ ...BODY, itemId: "00000000-0000-4000-8000-000000000602" });
    expect(h.recordUsageFor.mock.calls[0]?.[1]).toMatchObject({ itemId: ITEM_ID });
  });

  it.each([
    ["a zero quantity", { ...BODY, qty: 0 }],
    ["a missing package", { qty: 1 }],
    ["a package that is not an id", { ...BODY, packageId: "pool" }],
  ])("returns 400 for %s", async (_label, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("VALIDATION");
    expect(h.recordUsageFor).not.toHaveBeenCalled();
  });

  it("returns 401 without a Bearer header", async () => {
    h.bearerToken = null;
    const res = await call(BODY);
    expect(res.status).toBe(401);
    expect(h.recordUsageFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a client", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN"));
    const res = await call(BODY);
    expect(res.status).toBe(403);
  });

  it("returns 404 for an item id that is not a uuid", async () => {
    const res = await call(BODY, "CEM-53");
    expect(res.status).toBe(404);
  });

  it("maps NEGATIVE_STOCK to 409 with the domain copy", async () => {
    h.recordUsageFor.mockRejectedValue(new Error("NEGATIVE_STOCK: only 3 on hand"));
    const res = await call(BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "NEGATIVE_STOCK", message: "Not enough stock on hand." });
  });
});
