import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * POST /api/mobile/v1/bills/:billId/reject — Bearer first, client only
 * (the web rejectBill's clientAction guard), BILLING_ENABLED honoured, the
 * body validated by the web's own rejectBillSchema (real — the reason
 * trimmed, then required), the shared transitionBillFor (mocked) called with
 * toStatus "draft" and the trimmed reason as its note, `{ id, status }` only,
 * and the RPC's errors mapped through lib/mobile/api.ts.
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

function call(body: unknown, billId = BILL_ID, raw?: string) {
  return POST(
    new Request(`http://localhost/api/mobile/v1/bills/${billId}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ billId }) }
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
  h.env.BILLING_ENABLED = true;
  h.requireSession.mockReset();
  h.requireSession.mockResolvedValue(sessionAs("client"));
  h.transitionBillFor.mockReset();
  h.transitionBillFor.mockResolvedValue({ id: BILL_ID, status: "draft", projectId: PROJECT_ID });
});

describe("POST /api/mobile/v1/bills/:billId/reject", () => {
  it("rejects for a client with the trimmed reason, returning { id, status } only (200, no-store)", async () => {
    const session = sessionAs("client");
    h.requireSession.mockResolvedValue(session);

    const res = await call({ reason: "  GST rate is wrong  " });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: BILL_ID, status: "draft" });
    expect(h.transitionBillFor).toHaveBeenCalledExactlyOnceWith(session, {
      billId: BILL_ID,
      toStatus: "draft",
      note: "GST rate is wrong",
    });
  });

  it("uses the URL's bill id, ignoring any in the body", async () => {
    await call({ reason: "x", billId: "00000000-0000-4000-8000-0000000000e9" });

    expect(h.transitionBillFor.mock.calls[0]?.[1]).toMatchObject({ billId: BILL_ID });
  });

  it.each([
    ["missing", {}],
    ["empty", { reason: "" }],
    ["whitespace only", { reason: "   \n " }],
  ])("returns 400 with the web schema's message for a reason that is %s", async (_label, body) => {
    await expectError(await call(body), 400, "VALIDATION", "Please give a reason");
    expect(h.transitionBillFor).not.toHaveBeenCalled();
  });

  it("returns 400 for a reason that is not a string", async () => {
    const res = await call({ reason: 42 });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("VALIDATION");
    expect(h.transitionBillFor).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{nope", "Request body must be valid JSON."],
    ["not an object", "[]", "Request body must be a JSON object."],
  ])("returns 400 for %s", async (_label, raw, message) => {
    await expectError(await call(null, BILL_ID, raw), 400, "VALIDATION", message);
    expect(h.transitionBillFor).not.toHaveBeenCalled();
  });

  it.each(["admin", "site"] as const)("returns 403 for %s — only a client rejects", async (role) => {
    h.requireSession.mockResolvedValue(sessionAs(role));

    await expectError(await call({ reason: "x" }), 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.transitionBillFor).not.toHaveBeenCalled();
  });

  it("returns 401 with no Bearer header, before the session is read", async () => {
    h.bearerToken = null;

    await expectError(
      await call({ reason: "x" }),
      401,
      "UNAUTHENTICATED",
      "Your session expired. Please sign in again."
    );
    expect(h.requireSession).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed bill id, before any write", async () => {
    await expectError(
      await call({ reason: "x" }, "not-a-uuid"),
      404,
      "NOT_FOUND",
      "This bill isn't available."
    );
    expect(h.transitionBillFor).not.toHaveBeenCalled();
  });

  it("returns 404 while BILLING_ENABLED is off", async () => {
    h.env.BILLING_ENABLED = false;

    await expectError(await call({ reason: "x" }), 404, "NOT_FOUND", "Billing isn't available yet.");
    expect(h.transitionBillFor).not.toHaveBeenCalled();
  });

  it("returns 409 when the bill is no longer submitted (the RPC's ILLEGAL_TRANSITION)", async () => {
    h.transitionBillFor.mockRejectedValue(
      new Error("ILLEGAL_TRANSITION: draft to draft is not a legal transition")
    );

    await expectError(
      await call({ reason: "x" }),
      409,
      "ILLEGAL_TRANSITION",
      "This request has already moved on. Refresh to see the current status."
    );
  });

  it("returns the single bill answer for the RPC's NOT_FOUND (missing or deleted bill)", async () => {
    h.transitionBillFor.mockRejectedValue(new Error(`NOT_FOUND: bill ${BILL_ID} does not exist`));

    await expectError(await call({ reason: "x" }), 404, "NOT_FOUND", "This bill isn't available.");
  });

  it("returns 422 for the RPC's own REASON_REQUIRED", async () => {
    h.transitionBillFor.mockRejectedValue(
      new Error("REASON_REQUIRED: a reason is required to reject a bill")
    );

    await expectError(await call({ reason: "x" }), 422, "REASON_REQUIRED", "Please give a reason.");
  });

  it("returns 403 for a non-member's bill (the RPC's own check)", async () => {
    h.transitionBillFor.mockRejectedValue(new Error(`FORBIDDEN: not a member of project ${PROJECT_ID}`));

    await expectError(await call({ reason: "x" }), 403, "FORBIDDEN", "You don't have permission to do that.");
  });
});
