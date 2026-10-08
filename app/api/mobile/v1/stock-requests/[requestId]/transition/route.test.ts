import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required (a cookie session alone never
 * authorizes it), admin/site only, the request id checked, the body
 * validated by the web action's own transitionStockRequestSchema (real, not
 * mocked) with the URL's id authoritative, the shared
 * transitionStockRequestFor called with the authenticated session, only
 * `{ id, status }` returned, and the RPC's refusals mapped to statuses with
 * mapDomainError's copy. The helper is mocked — it is tested in
 * features/stock/transition.test.ts, the RPC against Postgres in
 * tests/integration/stock-and-inventory.test.ts.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireRole: vi.fn(),
    transitionStockRequestFor: vi.fn(),
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
vi.mock("@/features/stock/transition", () => ({ transitionStockRequestFor: h.transitionStockRequestFor }));

const { POST } = await import("./route");

const REQUEST_ID = "00000000-0000-4000-8000-0000000000f9";
const OTHER_REQUEST_ID = "00000000-0000-4000-8000-0000000000f8";
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

function call(body: unknown, requestId = REQUEST_ID, raw?: string) {
  return POST(
    new Request(`http://localhost/api/mobile/v1/stock-requests/${requestId}/transition`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ requestId }) }
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
  h.transitionStockRequestFor.mockReset();
  h.transitionStockRequestFor.mockImplementation(
    async (_session: Session, input: { requestId: string; toStatus: string }) => ({
      id: input.requestId,
      status: input.toStatus,
      projectId: PROJECT_ID,
    })
  );
});

describe("POST /api/mobile/v1/stock-requests/:requestId/transition", () => {
  it("moves the request and returns { id, status } only (200, no-store)", async () => {
    const res = await call({ toStatus: "approved" });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: REQUEST_ID, status: "approved" });
  });

  it.each([
    ["admin", { toStatus: "approved" }],
    ["admin", { toStatus: "rejected", note: "Wrong spec" }],
    ["admin", { toStatus: "ordered" }],
    ["admin", { toStatus: "delivered" }],
    ["site", { toStatus: "delivered" }],
  ] as const)("lets %s send %j through to the shared helper with that session", async (role, body) => {
    const session = sessionAs(role);
    h.requireRole.mockResolvedValue(session);

    const res = await call(body);

    expect(res.status).toBe(200);
    expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["admin", "site"]);
    expect(h.transitionStockRequestFor).toHaveBeenCalledExactlyOnceWith(session, {
      requestId: REQUEST_ID,
      ...body,
    });
  });

  it("leaves the decision to the RPC: a site supervisor's approve is sent, and its refusal mapped", async () => {
    h.requireRole.mockResolvedValue(sessionAs("site"));
    h.transitionStockRequestFor.mockRejectedValue(new Error("FORBIDDEN: requires admin"));

    const res = await call({ toStatus: "approved" });

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.transitionStockRequestFor).toHaveBeenCalledOnce();
  });

  it("returns no financial or other row field, whatever the helper returns", async () => {
    h.transitionStockRequestFor.mockResolvedValue({
      id: REQUEST_ID,
      status: "delivered",
      projectId: PROJECT_ID,
      rate: 410,
      value: 49200,
      billed_on_bill_id: "00000000-0000-4000-8000-000000000401",
    });

    const body = await (await call({ toStatus: "delivered" })).json();

    expect(Object.keys(body).sort()).toEqual(["id", "status"]);
  });

  it("makes the URL's request id authoritative over a body requestId", async () => {
    await call({ toStatus: "approved", requestId: OTHER_REQUEST_ID });

    expect(h.transitionStockRequestFor.mock.calls[0]?.[1]).toEqual({
      requestId: REQUEST_ID,
      toStatus: "approved",
    });
  });

  it("passes the note trimmed, as the schema does", async () => {
    await call({ toStatus: "rejected", note: "  Vendor cannot supply  " });

    expect(h.transitionStockRequestFor.mock.calls[0]?.[1]).toEqual({
      requestId: REQUEST_ID,
      toStatus: "rejected",
      note: "Vendor cannot supply",
    });
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    // No Authorization header: even if the cookie session would resolve to
    // an admin, nothing past the Bearer check runs.
    h.bearerToken = null;

    const res = await call({ toStatus: "approved" });

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.transitionStockRequestFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call({ toStatus: "approved" });

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.transitionStockRequestFor).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, before anything is changed", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin, site"));

    const res = await call({ toStatus: "delivered" });

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.transitionStockRequestFor).not.toHaveBeenCalled();
  });

  it("returns 404 for a request id that is not a uuid, before anything is changed", async () => {
    const res = await call({ toStatus: "approved" }, "not-a-uuid");

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.transitionStockRequestFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, REQUEST_ID, "toStatus=approved");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
    expect(h.transitionStockRequestFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not an object", async () => {
    const res = await call(["approved"]);

    await expectError(res, 400, "VALIDATION", "Request body must be a JSON object.");
  });

  it.each([
    ["a missing toStatus", {}],
    ["pending — not a transition target", { toStatus: "pending" }],
    ["an unknown status", { toStatus: "cancelled" }],
    ["a status in another case", { toStatus: "APPROVED" }],
    ["a note that is not text", { toStatus: "rejected", note: 42 }],
  ])("returns 400 for %s, with the schema's own message", async (_label, body) => {
    const res = await call(body);

    await expectError(res, 400, "VALIDATION", /./);
    expect(h.transitionStockRequestFor).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing note", { toStatus: "rejected" }],
    ["a blank note", { toStatus: "rejected", note: "   " }],
  ])("sends a rejection with %s to the RPC and returns its REASON_REQUIRED as 422", async (_label, body) => {
    h.transitionStockRequestFor.mockRejectedValue(
      new Error("REASON_REQUIRED: a reason is required to reject a request")
    );

    const res = await call(body);

    await expectError(res, 422, "REASON_REQUIRED", "Please give a reason.");
    expect(h.transitionStockRequestFor).toHaveBeenCalledOnce();
  });

  it("returns 409 for an illegal transition, with the existing copy", async () => {
    h.transitionStockRequestFor.mockRejectedValue(
      new Error("ILLEGAL_TRANSITION: delivered to delivered is not a legal transition")
    );

    const res = await call({ toStatus: "delivered" });

    await expectError(
      res,
      409,
      "ILLEGAL_TRANSITION",
      "This request has already moved on. Refresh to see the current status."
    );
  });

  it.each([
    [
      `NOT_FOUND: stock request ${REQUEST_ID} does not exist`,
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
  ] as const)("maps the RPC's %s to its status and copy", async (message, status, code, copy) => {
    h.transitionStockRequestFor.mockRejectedValue(new Error(message));

    const res = await call({ toStatus: "approved" });

    await expectError(res, status, code, copy);
  });

  it("returns 500 with a reference for an unexpected error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.transitionStockRequestFor.mockRejectedValue(new Error('relation "stock_requests" does not exist'));

    const res = await call({ toStatus: "approved" });

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
