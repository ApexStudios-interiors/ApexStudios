import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required (a cookie session alone never
 * authorizes it), admin only (site, client → 403), the item id checked, only
 * `newQty` and `reason` read from the body and validated by the web action's
 * own adjustInventorySchema (real, not mocked), the shared
 * adjustInventoryFor called with the session, `{ id, qtyOnHand,
 * reorderLevel, status }` returned, no-store, and the RPC's refusals mapped
 * with mapDomainError's copy. The helper is mocked — it is tested in
 * features/inventory/adjust.test.ts.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireRole: vi.fn(),
    adjustInventoryFor: vi.fn(),
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
vi.mock("@/features/inventory/adjust", () => ({ adjustInventoryFor: h.adjustInventoryFor }));

const { POST } = await import("./route");

const ITEM_ID = "00000000-0000-4000-8000-000000000601";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

function sessionAs(role: Session["role"]): Session {
  return {
    userId: "00000000-0000-4000-8000-0000000000d2",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating: null,
  };
}

const BODY = { newQty: 25, reason: "Physical stock count" };

function call(body: unknown, itemId = ITEM_ID, raw?: string) {
  return POST(
    new Request(`http://localhost/api/mobile/v1/inventory/${itemId}/adjust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ itemId }) }
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
  h.requireRole.mockResolvedValue(sessionAs("admin"));
  h.adjustInventoryFor.mockReset();
  h.adjustInventoryFor.mockImplementation(async (_s: Session, input: { itemId: string; newQty: number }) => ({
    id: input.itemId,
    projectId: PROJECT_ID,
    qtyOnHand: input.newQty,
    reorderLevel: 10,
    status: input.newQty === 0 ? "critical" : input.newQty < 10 ? "low" : "ok",
  }));
});

describe("POST /api/mobile/v1/inventory/:itemId/adjust", () => {
  it("adjusts the item and returns exactly { id, qtyOnHand, reorderLevel, status } (200, no-store)", async () => {
    const res = await call(BODY);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: ITEM_ID, qtyOnHand: 25, reorderLevel: 10, status: "ok" });
  });

  it("lets an admin adjust, calling the shared helper — and so the RPC, its movement and its audit — with the session", async () => {
    const session = sessionAs("admin");
    h.requireRole.mockResolvedValue(session);

    await call(BODY);

    expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["admin"]);
    expect(h.adjustInventoryFor).toHaveBeenCalledExactlyOnceWith(session, {
      itemId: ITEM_ID,
      newQty: 25,
      reason: "Physical stock count",
    });
  });

  it.each([
    ["down to zero", 0, "critical"],
    ["below the minimum", 4, "low"],
    ["a fraction", 12.5, "ok"],
  ] as const)("accepts a new quantity %s and returns its status", async (_label, newQty, status) => {
    const res = await call({ ...BODY, newQty });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ qtyOnHand: newQty, status });
  });

  it('accepts a numeric string ("25"), as the web schema coerces', async () => {
    await call({ ...BODY, newQty: "25" });

    expect(h.adjustInventoryFor.mock.calls[0]?.[1]).toMatchObject({ newQty: 25 });
  });

  it("trims the reason, as the web schema does", async () => {
    await call({ ...BODY, reason: "  Physical stock count  " });

    expect(h.adjustInventoryFor.mock.calls[0]?.[1]).toMatchObject({ reason: "Physical stock count" });
  });

  it("never lets the body choose the item", async () => {
    await call({ ...BODY, itemId: "00000000-0000-4000-8000-000000000602" });

    expect(h.adjustInventoryFor.mock.calls[0]?.[1]).toMatchObject({ itemId: ITEM_ID });
  });

  it.each([
    ["a negative quantity", { ...BODY, newQty: -1 }, "Quantity cannot be negative"],
    ["a missing reason", { newQty: 25 }, /./],
    ["a blank reason", { ...BODY, reason: "   " }, "A reason is required"],
    ["a quantity that is not a number", { ...BODY, newQty: "lots" }, /./],
    ["a reason that is not text", { ...BODY, reason: 42 }, /./],
  ])("returns 400 for %s, changing nothing", async (_label, body, message) => {
    const res = await call(body);

    await expectError(res, 400, "VALIDATION", message);
    expect(h.adjustInventoryFor).not.toHaveBeenCalled();
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call(BODY);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.adjustInventoryFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call(BODY);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.adjustInventoryFor).not.toHaveBeenCalled();
  });

  it.each(["site", "client"])("returns 403 for %s, changing nothing", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin"));

    const res = await call(BODY);

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.adjustInventoryFor).not.toHaveBeenCalled();
  });

  it("returns 404 for an item id that is not a uuid, changing nothing", async () => {
    const res = await call(BODY, "CEM-53");

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.adjustInventoryFor).not.toHaveBeenCalled();
  });

  it("returns 404 for an item this admin cannot see, or that no longer exists", async () => {
    h.adjustInventoryFor.mockRejectedValue(new Error("NOT_FOUND: this inventory item no longer exists"));

    const res = await call(BODY);

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
  });

  it.each([
    ["the RPC's admin-only check", "FORBIDDEN: rpc_adjust_inventory is admin-only", 403, "FORBIDDEN"],
    [
      "the RPC's reason check",
      "REASON_REQUIRED: a reason is required to adjust inventory",
      422,
      "REASON_REQUIRED",
    ],
    ["the RPC's own not-found", `NOT_FOUND: inventory item ${ITEM_ID} does not exist`, 404, "NOT_FOUND"],
  ] as const)("maps %s", async (_label, message, status, code) => {
    h.adjustInventoryFor.mockRejectedValue(new Error(message));

    const res = await call(BODY);

    await expectError(res, status, code, /./);
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, ITEM_ID, "newQty=25");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
  });

  it("returns 400 for a body that is not an object", async () => {
    const res = await call([25, "count"]);

    await expectError(res, 400, "VALIDATION", "Request body must be a JSON object.");
  });

  it("returns 500 with a reference for an unexpected error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.adjustInventoryFor.mockRejectedValue(new Error('relation "stock_movements" does not exist'));

    const res = await call(BODY);

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    consoleError.mockRestore();
  });
});
