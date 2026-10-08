import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * GET /api/mobile/v1/projects/:projectId/bills — Bearer first, admin and
 * client only (site 403), BILLING_ENABLED honoured (404), project access
 * enforced, the web Billing page's own paged queries called (admin →
 * getBillsPageForAdmin, client → getBillsPageForClient, both mocked; their
 * role shaping is the queries' own), and only the listed fields returned —
 * cost and margin for an admin only. Errors through lib/mobile/api.ts.
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
    requireProjectAccess: vi.fn(),
    getBillsPageForAdmin: vi.fn(),
    getBillsPageForClient: vi.fn(),
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
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/features/billing/queries", () => ({
  getBillsPageForAdmin: h.getBillsPageForAdmin,
  getBillsPageForClient: h.getBillsPageForClient,
}));

const { GET } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000b1";
const BILL_ID = "00000000-0000-4000-8000-0000000000e1";

function sessionAs(role: Session["role"], impersonating: Session["impersonating"] = null): Session {
  return {
    userId: "00000000-0000-4000-8000-0000000000d1",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating,
  };
}

function get(projectId = PROJECT_ID, search = "") {
  return GET(new Request(`http://localhost/api/mobile/v1/projects/${projectId}/bills${search}`), {
    params: Promise.resolve({ projectId }),
  });
}

/** A BillDTO as the CLIENT query shapes it — no internal keys. */
const CLIENT_BILL = {
  id: BILL_ID,
  projectId: PROJECT_ID,
  refNo: "RA-APX-001",
  billDate: "2026-10-01",
  periodFrom: "2026-09-01",
  periodTo: "2026-09-30",
  status: "submitted" as const,
  revision: 1,
  workValue: 100000,
  materialValue: 20000,
  grossAmount: 120000,
  masRecoveryAmount: 0,
  taxableAmount: 120000,
  gstAmount: 21600,
  invoiceTotal: 141600,
  retentionAmount: 6000,
  tdsAmount: 0,
  advanceRecovery: 0,
  netPayable: 135600,
  gstRatePct: 18,
  retentionPct: 5,
  tdsPct: 0,
  notes: "First RA bill",
  submittedAt: "2026-10-01T10:00:00Z",
  certifiedAt: null,
  certificationNote: null,
  paidAt: null,
  createdAt: "2026-10-01T09:00:00Z",
  packageLabels: ["Civil", "Swimming Pool"],
};
/** The same bill as the ADMIN query shapes it. */
const ADMIN_BILL = { ...CLIENT_BILL, internalCostAmount: 90000, marginAmount: 30000 };

const SUMMARY_KEYS = [
  "billDate",
  "gstAmount",
  "id",
  "invoiceTotal",
  "netPayable",
  "packageLabels",
  "paidAt",
  "periodFrom",
  "periodTo",
  "refNo",
  "revision",
  "status",
  "submittedAt",
  "taxableAmount",
  "certifiedAt",
].sort();

function pageOf<T>(rows: T[], total = rows.length, page = 1) {
  return { rows, total, page, pageSize: 25 };
}

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.env.BILLING_ENABLED = true;
  h.requireSession.mockReset();
  h.requireSession.mockResolvedValue(sessionAs("admin"));
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.getBillsPageForAdmin.mockReset();
  h.getBillsPageForAdmin.mockResolvedValue(pageOf([ADMIN_BILL]));
  h.getBillsPageForClient.mockReset();
  h.getBillsPageForClient.mockResolvedValue(pageOf([CLIENT_BILL]));
});

async function expectError(res: Response, status: number, error: string, message: string | RegExp) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(["error", "message"]);
  expect(body.error).toBe(error);
  if (typeof message === "string") expect(body.message).toBe(message);
  else expect(body.message).toMatch(message);
}

function expectNoRead() {
  expect(h.getBillsPageForAdmin).not.toHaveBeenCalled();
  expect(h.getBillsPageForClient).not.toHaveBeenCalled();
}

describe("GET /api/mobile/v1/projects/:projectId/bills", () => {
  it("gives an admin the admin query's page, with cost and margin (200, no-store)", async () => {
    const session = sessionAs("admin");
    h.requireSession.mockResolvedValue(session);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
    expect(h.getBillsPageForAdmin).toHaveBeenCalledExactlyOnceWith(PROJECT_ID, { page: 1, pageSize: 25 });
    expect(h.getBillsPageForClient).not.toHaveBeenCalled();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["bills", "hasMore", "page", "pageSize", "role", "total"]);
    expect(body).toMatchObject({ role: "admin", total: 1, page: 1, pageSize: 25, hasMore: false });
    expect(Object.keys(body.bills[0]).sort()).toEqual(
      [...SUMMARY_KEYS, "internalCostAmount", "marginAmount"].sort()
    );
    expect(body.bills[0]).toMatchObject({
      id: BILL_ID,
      refNo: "RA-APX-001",
      netPayable: 135600,
      packageLabels: ["Civil", "Swimming Pool"],
      internalCostAmount: 90000,
      marginAmount: 30000,
    });
  });

  it("gives a client with project access the client query's page — no internal keys at all", async () => {
    const session = sessionAs("client");
    h.requireSession.mockResolvedValue(session);

    const res = await get();

    expect(res.status).toBe(200);
    expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
    expect(h.getBillsPageForClient).toHaveBeenCalledExactlyOnceWith(PROJECT_ID, { page: 1, pageSize: 25 });
    expect(h.getBillsPageForAdmin).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.role).toBe("client");
    expect(Object.keys(body.bills[0]).sort()).toEqual(SUMMARY_KEYS);
    expect(JSON.stringify(body)).not.toMatch(/internalCost|margin/i);
  });

  it("never copies an internal figure onto a client response, even if a query returned one", async () => {
    h.requireSession.mockResolvedValue(sessionAs("client"));
    h.getBillsPageForClient.mockResolvedValue(pageOf([ADMIN_BILL]));

    const body = await (await get()).json();

    expect(body.bills[0]).not.toHaveProperty("internalCostAmount");
    expect(body.bills[0]).not.toHaveProperty("marginAmount");
  });

  it("drops DTO fields the list does not need (lines-level figures, notes, project id)", async () => {
    const body = await (await get()).json();

    for (const key of ["notes", "projectId", "workValue", "grossAmount", "certificationNote", "createdAt"]) {
      expect(body.bills[0]).not.toHaveProperty(key);
    }
  });

  it("pages: passes ?page through and says hasMore from the query's total", async () => {
    h.getBillsPageForAdmin.mockResolvedValue(pageOf([ADMIN_BILL], 60, 2));

    const body = await (await get(PROJECT_ID, "?page=2")).json();

    expect(h.getBillsPageForAdmin).toHaveBeenCalledExactlyOnceWith(PROJECT_ID, { page: 2, pageSize: 25 });
    expect(body).toMatchObject({ total: 60, page: 2, pageSize: 25, hasMore: true });
  });

  it("returns an empty list for a project with no bills", async () => {
    h.getBillsPageForAdmin.mockResolvedValue(pageOf([], 0));

    const body = await (await get()).json();

    expect(body).toEqual({ role: "admin", bills: [], total: 0, page: 1, pageSize: 25, hasMore: false });
  });

  it.each(["0", "-1", "abc", "1.5", "1001"])("returns 400 for page=%s, before any read", async (raw) => {
    const res = await get(PROJECT_ID, `?page=${raw}`);

    await expectError(res, 400, "VALIDATION", "page must be a whole number from 1 to 1000.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expectNoRead();
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await get();

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireSession).not.toHaveBeenCalled();
    expectNoRead();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    await expectError(await get(), 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expectNoRead();
  });

  it("returns 403 for a site supervisor — no billing access at all", async () => {
    h.requireSession.mockResolvedValue(sessionAs("site"));

    await expectError(await get(), 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expectNoRead();
  });

  it("returns 403 for an admin previewing as site, as the web page does", async () => {
    h.requireSession.mockResolvedValue(sessionAs("admin", { role: "site", projectId: PROJECT_ID }));

    await expectError(await get(), 403, "FORBIDDEN", "You don't have permission to do that.");
    expectNoRead();
  });

  it("returns 403 for a project the user cannot access, with no read", async () => {
    h.requireSession.mockResolvedValue(sessionAs("client"));
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    await expectError(await get(), 403, "FORBIDDEN", "You don't have permission to do that.");
    expectNoRead();
  });

  it("returns 404 for a malformed project id, before any access check or read", async () => {
    await expectError(await get("not-a-uuid"), 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expectNoRead();
  });

  it("returns 404 while BILLING_ENABLED is off, as the web page's notFound()", async () => {
    h.env.BILLING_ENABLED = false;

    await expectError(await get(), 404, "NOT_FOUND", "Billing isn't available yet.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expectNoRead();
  });

  it("returns 500 with a reference for a query error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.getBillsPageForAdmin.mockRejectedValue(new Error('relation "bills" does not exist'));

    const res = await get();

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    consoleError.mockRestore();
  });
});
