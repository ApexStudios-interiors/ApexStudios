import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * POST /api/mobile/v1/bills/:billId/certify — Bearer first, client only
 * (the web certifyBill's clientAction guard), BILLING_ENABLED honoured, the
 * web's transitionBillSchema (real) and the shared transitionBillFor
 * (mocked; tested in features/billing/transition.test.ts) called with the
 * authenticated session, `{ id, status }` only, and the RPC's errors mapped
 * through lib/mobile/api.ts — 409 for an already-decided bill.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    env: { BILLING_ENABLED: true },
    requireSession: vi.fn(),
    transitionBillFor: vi.fn(),
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
  requireRole: vi.fn(),
  requireProjectAccess: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/features/billing/transition", () => ({ transitionBillFor: h.transitionBillFor }));

const { POST } = await import("./route");

const BILL_ID = "00000000-0000-4000-8000-0000000000e1";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

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

function call(billId = BILL_ID) {
  return POST(new Request(`http://localhost/api/mobile/v1/bills/${billId}/certify`, { method: "POST" }), {
    params: Promise.resolve({ billId }),
  });
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
  h.env.BILLING_ENABLED = true;
  h.requireSession.mockReset();
  h.requireSession.mockResolvedValue(sessionAs("client"));
  h.transitionBillFor.mockReset();
  h.transitionBillFor.mockResolvedValue({ id: BILL_ID, status: "certified", projectId: PROJECT_ID });
});

describe("POST /api/mobile/v1/bills/:billId/certify", () => {
  it("certifies for a client via the shared helper and returns { id, status } only (200, no-store)", async () => {
    const session = sessionAs("client");
    h.requireSession.mockResolvedValue(session);

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: BILL_ID, status: "certified" });
    expect(h.transitionBillFor).toHaveBeenCalledExactlyOnceWith(session, {
      billId: BILL_ID,
      toStatus: "certified",
    });
  });

  it.each(["admin", "site"] as const)("returns 403 for %s — only a client certifies", async (role) => {
    h.requireSession.mockResolvedValue(sessionAs(role));

    await expectError(await call(), 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.transitionBillFor).not.toHaveBeenCalled();
  });

  it("returns 401 with no Bearer header, before the session is read", async () => {
    h.bearerToken = null;

    await expectError(await call(), 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.transitionBillFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    await expectError(await call(), 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.transitionBillFor).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed bill id, before any write", async () => {
    await expectError(await call("not-a-uuid"), 404, "NOT_FOUND", "This bill isn't available.");
    expect(h.transitionBillFor).not.toHaveBeenCalled();
  });

  it("returns 404 while BILLING_ENABLED is off, before any write", async () => {
    h.env.BILLING_ENABLED = false;

    await expectError(await call(), 404, "NOT_FOUND", "Billing isn't available yet.");
    expect(h.transitionBillFor).not.toHaveBeenCalled();
  });

  it("returns 409 when the bill was already decided (the RPC's ILLEGAL_TRANSITION)", async () => {
    h.transitionBillFor.mockRejectedValue(
      new Error("ILLEGAL_TRANSITION: certified to certified is not a legal transition")
    );

    await expectError(
      await call(),
      409,
      "ILLEGAL_TRANSITION",
      "This request has already moved on. Refresh to see the current status."
    );
  });

  it("returns 403 for a bill of a project the client is not a member of (the RPC's own check)", async () => {
    h.transitionBillFor.mockRejectedValue(new Error(`FORBIDDEN: not a member of project ${PROJECT_ID}`));

    await expectError(await call(), 403, "FORBIDDEN", "You don't have permission to do that.");
  });

  it("returns 404 for a bill that does not exist (the RPC's NOT_FOUND)", async () => {
    h.transitionBillFor.mockRejectedValue(new Error(`NOT_FOUND: bill ${BILL_ID} does not exist`));

    await expectError(await call(), 404, "NOT_FOUND", "This bill isn't available.");
  });

  it("returns 500 with a reference for anything else, never the raw message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.transitionBillFor.mockRejectedValue(new Error('relation "bills" does not exist'));

    await expectError(await call(), 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    consoleError.mockRestore();
  });
});
