import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required, client-only, the URL id and the
 * body validated together by decideApprovalSchema, `rpc_decide_approval`
 * called exactly as the web action calls it, the RPC's domain errors mapped
 * to statuses with mapDomainError's copy, and only five columns of the row
 * ever returned. The RPC's own rules are tested against Postgres in
 * tests/integration/approvals.test.ts.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireRole: vi.fn(),
    rpc: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireRole: h.requireRole,
  requireSession: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getBearerToken: async () => h.bearerToken,
  createClient: async () => ({ rpc: h.rpc }),
}));

const { POST } = await import("./route");

const APPROVAL_ID = "00000000-0000-4000-8000-0000000000e1";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000b1";

const CLIENT: Session = {
  userId: "00000000-0000-4000-8000-0000000000d1",
  orgId: "00000000-0000-4000-8000-0000000000a0",
  role: "client",
  fullName: "Client",
  email: null,
  impersonating: null,
};

/** The full row the RPC returns — far more than the route may send back. */
function rpcRow(status: "approved" | "rejected", reason: string | null) {
  return {
    id: APPROVAL_ID,
    org_id: CLIENT.orgId,
    project_id: PROJECT_ID,
    package_id: "00000000-0000-4000-8000-0000000000c1",
    phase_id: null,
    ref_no: "AP-BHEL-NCH-001",
    type: "material_sample",
    item: "Granite sample",
    note: "Internal note",
    needed_by: null,
    status,
    requested_by: "00000000-0000-4000-8000-0000000000d2",
    decided_by: CLIENT.userId,
    decided_at: "2026-10-07T10:00:00.000Z",
    decision_reason: reason,
    supersedes_id: null,
    created_at: "2026-10-01T10:00:00.000Z",
    created_by: "00000000-0000-4000-8000-0000000000d2",
    updated_at: "2026-10-07T10:00:00.000Z",
    updated_by: CLIENT.userId,
    deleted_at: null,
  };
}

function call(body: unknown, approvalId = APPROVAL_ID, raw?: string) {
  return POST(
    new Request(`http://localhost/api/mobile/v1/approvals/${approvalId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ approvalId }) }
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
  h.requireRole.mockResolvedValue(CLIENT);
  h.rpc.mockReset();
});

describe("POST /api/mobile/v1/approvals/:approvalId/decision", () => {
  it("approves: calls rpc_decide_approval as the web action does, returns the five fields, no-store", async () => {
    h.rpc.mockResolvedValue({ data: rpcRow("approved", null), error: null });

    const res = await call({ decision: "approved" });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["client"]);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_decide_approval", {
      p_approval_id: APPROVAL_ID,
      p_decision: "approved",
      p_reason: undefined,
    });
    expect(await res.json()).toEqual({
      approval: {
        id: APPROVAL_ID,
        projectId: PROJECT_ID,
        status: "approved",
        decidedAt: "2026-10-07T10:00:00.000Z",
        decisionReason: null,
      },
    });
  });

  it("rejects with a reason (trimmed by the schema)", async () => {
    h.rpc.mockResolvedValue({ data: rpcRow("rejected", "Wrong shade"), error: null });

    const res = await call({ decision: "rejected", reason: "  Wrong shade  " });

    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_decide_approval", {
      p_approval_id: APPROVAL_ID,
      p_decision: "rejected",
      p_reason: "Wrong shade",
    });
    const body = await res.json();
    expect(body.approval).toMatchObject({ status: "rejected", decisionReason: "Wrong shade" });
  });

  it("never exposes the raw database row", async () => {
    h.rpc.mockResolvedValue({ data: rpcRow("approved", null), error: null });

    const body = await (await call({ decision: "approved" })).json();

    expect(Object.keys(body)).toEqual(["approval"]);
    expect(Object.keys(body.approval).sort()).toEqual(
      ["decidedAt", "decisionReason", "id", "projectId", "status"].sort()
    );
    for (const leaked of ["org_id", "note", "item", "requested_by", "decided_by", "ref_no"]) {
      expect(JSON.stringify(body)).not.toContain(leaked);
    }
  });

  it("returns 400 when rejecting without a reason, before calling the RPC", async () => {
    const res = await call({ decision: "rejected", reason: "   " });

    await expectError(res, 400, "VALIDATION", "Please give a reason for rejecting");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown decision", async () => {
    const res = await call({ decision: "maybe" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("VALIDATION");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, APPROVAL_ID, "decision=approved");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("uses the URL's approval id, not one smuggled into the body", async () => {
    h.rpc.mockResolvedValue({ data: rpcRow("approved", null), error: null });

    await call({ decision: "approved", approvalId: "00000000-0000-4000-8000-0000000000ff" });

    expect(h.rpc.mock.calls[0]?.[1]).toMatchObject({ p_approval_id: APPROVAL_ID });
  });

  it("returns 404 for an approval id that is not a uuid, without calling the RPC", async () => {
    const res = await call({ decision: "approved" }, "not-a-uuid");

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call({ decision: "approved" });

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    // Refused before any session lookup, so a browser cookie is never consulted.
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call({ decision: "approved" });

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each(["admin", "site"])("returns 403 for %s, without calling the RPC", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: client"));

    const res = await call({ decision: "approved" });

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_FOUND: approval x does not exist", 404, "NOT_FOUND", "That record no longer exists."],
    ["FORBIDDEN: not a member of project x", 403, "FORBIDDEN", "You don't have permission to do that."],
    [
      "ILLEGAL_TRANSITION: approval x is already approved",
      409,
      "ILLEGAL_TRANSITION",
      "This request has already moved on. Refresh to see the current status.",
    ],
    ["REASON_REQUIRED: a reason is required to reject", 422, "REASON_REQUIRED", "Please give a reason."],
  ] as const)("maps the RPC's %s to its status and copy", async (pgMessage, status, code, message) => {
    h.rpc.mockResolvedValue({ data: null, error: { message: pgMessage } });

    const res = await call({ decision: "approved" });

    await expectError(res, status, code, message);
    // The raw RPC message (with ids) never reaches the client.
    expect(JSON.stringify(await (await call({ decision: "approved" })).json())).not.toContain(pgMessage);
  });

  it("returns 500 with a reference for an unexpected error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.rpc.mockResolvedValue({ data: null, error: { message: 'relation "approvals" does not exist' } });

    const res = await call({ decision: "approved" });

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
