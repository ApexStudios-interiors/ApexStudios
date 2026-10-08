import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * GET /api/mobile/v1/projects/:projectId/bills/:billId — Bearer first, admin
 * and client only (site 403), BILLING_ENABLED honoured, project access
 * enforced, the bill required to belong to the URL's project (404
 * otherwise), a draft hidden from a client, and the web's own helpers
 * reused: getBillDetail (role-shaped), getBillPdfUrl (the presigned PDF
 * link), getBillPaymentsSummary (admin only). All three are mocked — their
 * own queries and role shaping are tested where they live.
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
    getBillDetail: vi.fn(),
    getBillPaymentsSummary: vi.fn(),
    getBillPdfUrl: vi.fn(),
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
  getBillDetail: h.getBillDetail,
  getBillPaymentsSummary: h.getBillPaymentsSummary,
}));
vi.mock("@/features/billing/actions", () => ({ getBillPdfUrl: h.getBillPdfUrl }));

const { GET } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000b1";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-0000000000b2";
const BILL_ID = "00000000-0000-4000-8000-0000000000e1";
const PDF_URL = "https://r2.example/apex-files/bills/RA-APX-001.pdf?X-Amz-Signature=abc&X-Amz-Expires=300";

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

function get(projectId = PROJECT_ID, billId = BILL_ID) {
  return GET(new Request(`http://localhost/api/mobile/v1/projects/${projectId}/bills/${billId}`), {
    params: Promise.resolve({ projectId, billId }),
  });
}

const CLIENT_BILL = {
  id: BILL_ID,
  projectId: PROJECT_ID,
  refNo: "RA-APX-001",
  billDate: "2026-10-01",
  periodFrom: "2026-09-01",
  periodTo: "2026-09-30",
  status: "certified" as BillStatus,
  revision: 2,
  workValue: 100000,
  materialValue: 20000,
  grossAmount: 120000,
  masRecoveryAmount: 5000,
  taxableAmount: 115000,
  gstAmount: 20700,
  invoiceTotal: 135700,
  retentionAmount: 5750,
  tdsAmount: 1150,
  advanceRecovery: 2000,
  netPayable: 126800,
  gstRatePct: 18,
  retentionPct: 5,
  tdsPct: 1,
  notes: "Second RA bill",
  submittedAt: "2026-10-01T10:00:00Z",
  certifiedAt: "2026-10-03T12:00:00Z",
  certificationNote: "Checked against site measurement",
  paidAt: null,
  createdAt: "2026-10-01T09:00:00Z",
  packageLabels: [],
};
type BillStatus = "draft" | "submitted" | "certified" | "paid" | "cancelled";
const ADMIN_BILL = { ...CLIENT_BILL, internalCostAmount: 90000, marginAmount: 25000 };

const CLIENT_LINE = {
  id: "00000000-0000-4000-8000-0000000000f1",
  sourceType: "phase" as const,
  description: "Civil — Foundation",
  clientValue: 100000,
  pctBilled: 100,
  amount: 100000,
};
const ADMIN_LINE = { ...CLIENT_LINE, internalCost: 75000 };
const COPY = {
  id: "00000000-0000-4000-8000-000000000a01",
  url: "https://r2.example/copy?sig",
  name: "scan.jpg",
};

function detailFor(role: "admin" | "client", bill: Record<string, unknown> = {}) {
  return role === "admin"
    ? { bill: { ...ADMIN_BILL, ...bill }, lines: [ADMIN_LINE], billCopyUrls: [COPY] }
    : { bill: { ...CLIENT_BILL, ...bill }, lines: [CLIENT_LINE], billCopyUrls: [COPY] };
}

const PAYMENTS = {
  paidSoFar: 50000,
  payments: [
    {
      id: "00000000-0000-4000-8000-000000000091",
      amount: 50000,
      paidOn: "2026-10-05",
      mode: "NEFT",
      referenceNo: "UTR123",
    },
  ],
};

const BILL_KEYS = [
  "advanceRecovery",
  "billDate",
  "certificationNote",
  "certifiedAt",
  "createdAt",
  "grossAmount",
  "gstAmount",
  "gstRatePct",
  "id",
  "invoiceTotal",
  "masRecoveryAmount",
  "materialValue",
  "netPayable",
  "notes",
  "paidAt",
  "periodFrom",
  "periodTo",
  "projectId",
  "refNo",
  "retentionAmount",
  "retentionPct",
  "revision",
  "status",
  "submittedAt",
  "taxableAmount",
  "tdsAmount",
  "tdsPct",
  "workValue",
].sort();

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.env.BILLING_ENABLED = true;
  h.requireSession.mockReset();
  h.requireSession.mockResolvedValue(sessionAs("admin"));
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.getBillDetail.mockReset();
  h.getBillDetail.mockImplementation(async (session: Session) =>
    detailFor(session.role === "admin" ? "admin" : "client")
  );
  h.getBillPaymentsSummary.mockReset();
  h.getBillPaymentsSummary.mockResolvedValue(PAYMENTS);
  h.getBillPdfUrl.mockReset();
  h.getBillPdfUrl.mockResolvedValue(PDF_URL);
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

/** Nothing about the bill was handed out — no PDF link, no payments. */
function expectNoBillData() {
  expect(h.getBillPdfUrl).not.toHaveBeenCalled();
  expect(h.getBillPaymentsSummary).not.toHaveBeenCalled();
}

describe("GET /api/mobile/v1/projects/:projectId/bills/:billId", () => {
  it("gives an admin the full bill: figures, internal block, lines with cost, copies, PDF and payments", async () => {
    const session = sessionAs("admin");
    h.requireSession.mockResolvedValue(session);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
    expect(h.getBillDetail).toHaveBeenCalledExactlyOnceWith(session, BILL_ID);
    expect(h.getBillPdfUrl).toHaveBeenCalledExactlyOnceWith(BILL_ID);
    expect(h.getBillPaymentsSummary).toHaveBeenCalledExactlyOnceWith(BILL_ID);

    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      "actions",
      "bill",
      "billCopies",
      "lines",
      "payments",
      "pdfUrl",
      "role",
    ]);
    // An admin never certifies or rejects — offered nothing, on any status.
    expect(body.actions).toEqual([]);
    expect(body.role).toBe("admin");
    expect(Object.keys(body.bill).sort()).toEqual(
      [...BILL_KEYS, "internalCostAmount", "marginAmount"].sort()
    );
    expect(body.bill).toMatchObject({ netPayable: 126800, internalCostAmount: 90000, marginAmount: 25000 });
    expect(body.lines).toEqual([ADMIN_LINE]);
    expect(body.billCopies).toEqual([COPY]);
    expect(body.pdfUrl).toBe(PDF_URL);
    expect(body.payments).toEqual({ paidSoFar: 50000, items: PAYMENTS.payments });
  });

  it("gives a client with access the client-shaped bill — no internal keys, no payments, but the PDF", async () => {
    const session = sessionAs("client");
    h.requireSession.mockResolvedValue(session);

    const res = await get();

    expect(res.status).toBe(200);
    expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
    expect(h.getBillDetail).toHaveBeenCalledExactlyOnceWith(session, BILL_ID);
    expect(h.getBillPdfUrl).toHaveBeenCalledExactlyOnceWith(BILL_ID);
    expect(h.getBillPaymentsSummary).not.toHaveBeenCalled();

    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["actions", "bill", "billCopies", "lines", "pdfUrl", "role"]);
    // A certified bill: already decided, nothing to offer.
    expect(body.actions).toEqual([]);
    expect(body.role).toBe("client");
    expect(Object.keys(body.bill).sort()).toEqual(BILL_KEYS);
    expect(body.lines).toEqual([CLIENT_LINE]);
    expect(body.pdfUrl).toBe(PDF_URL);
    expect(JSON.stringify(body)).not.toMatch(/internalCost|margin|payments|paidSoFar/i);
  });

  it("never copies an internal figure onto a client response, even if the helper returned one", async () => {
    h.requireSession.mockResolvedValue(sessionAs("client"));
    h.getBillDetail.mockResolvedValue(detailFor("admin"));

    const body = await (await get()).json();

    expect(body.bill).not.toHaveProperty("internalCostAmount");
    expect(body.bill).not.toHaveProperty("marginAmount");
    expect(body.lines[0]).not.toHaveProperty("internalCost");
  });

  it("offers a client certify and reject on a submitted bill — the server's own rule", async () => {
    h.requireSession.mockResolvedValue(sessionAs("client"));
    h.getBillDetail.mockResolvedValue(detailFor("client", { status: "submitted" }));

    const body = await (await get()).json();

    expect(body.actions).toEqual(["certify", "reject"]);
  });

  it("offers an admin nothing on a submitted bill", async () => {
    h.getBillDetail.mockResolvedValue(detailFor("admin", { status: "submitted" }));

    const body = await (await get()).json();

    expect(body.actions).toEqual([]);
  });

  it("returns pdfUrl null while the PDF has not been generated yet", async () => {
    h.getBillPdfUrl.mockResolvedValue(null);

    const body = await (await get()).json();

    expect(body.pdfUrl).toBeNull();
  });

  it("hands out only the helper's presigned link — no storage key, bucket config or credential", async () => {
    const body = JSON.stringify(await (await get()).json());

    expect(body).not.toMatch(/r2_key|r2Key|secret|accessKey|R2_|SUPABASE|service_role/i);
  });

  it("lets an admin see a draft", async () => {
    h.getBillDetail.mockResolvedValue(detailFor("admin", { status: "draft" }));

    const res = await get();

    expect(res.status).toBe(200);
    expect((await res.json()).bill.status).toBe("draft");
  });

  it("returns 404 for a draft to a client — the web never lists one to a client", async () => {
    h.requireSession.mockResolvedValue(sessionAs("client"));
    h.getBillDetail.mockResolvedValue(detailFor("client", { status: "draft" }));

    await expectError(await get(), 404, "NOT_FOUND", "This bill isn't available.");
    expectNoBillData();
  });

  it.each(["admin", "client"] as const)(
    "returns 404 to %s for a bill of another project, with no PDF or payments handed out",
    async (role) => {
      h.requireSession.mockResolvedValue(sessionAs(role));
      h.getBillDetail.mockResolvedValue(detailFor(role, { projectId: OTHER_PROJECT_ID }));

      await expectError(await get(), 404, "NOT_FOUND", "This bill isn't available.");
      expectNoBillData();
    }
  );

  it.each(["admin", "client"] as const)(
    "returns 404 to %s for a soft-deleted bill (the shared query returns none) — no PDF or payments",
    async (role) => {
      const session = sessionAs(role);
      h.requireSession.mockResolvedValue(session);
      h.getBillDetail.mockResolvedValue(null);

      await expectError(await get(), 404, "NOT_FOUND", "This bill isn't available.");
      expect(h.getBillDetail).toHaveBeenCalledExactlyOnceWith(session, BILL_ID);
      expectNoBillData();
    }
  );

  it("returns 404 for a bill that does not exist (or that RLS hides)", async () => {
    h.getBillDetail.mockResolvedValue(null);

    await expectError(await get(), 404, "NOT_FOUND", "This bill isn't available.");
    expectNoBillData();
  });

  it.each([
    ["project", "not-a-uuid", BILL_ID],
    ["bill", PROJECT_ID, "not-a-uuid"],
  ])(
    "returns 404 for a malformed %s id, before any access check or read",
    async (_label, projectId, billId) => {
      await expectError(await get(projectId, billId), 404, "NOT_FOUND", "This bill isn't available.");
      expect(h.requireProjectAccess).not.toHaveBeenCalled();
      expect(h.getBillDetail).not.toHaveBeenCalled();
      expectNoBillData();
    }
  );

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    await expectError(await get(), 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.getBillDetail).not.toHaveBeenCalled();
    expectNoBillData();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    await expectError(await get(), 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.getBillDetail).not.toHaveBeenCalled();
  });

  it("returns 403 for a site supervisor, with no read and no PDF link", async () => {
    h.requireSession.mockResolvedValue(sessionAs("site"));

    await expectError(await get(), 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getBillDetail).not.toHaveBeenCalled();
    expectNoBillData();
  });

  it("returns 403 for an admin previewing as site, as the web page does", async () => {
    h.requireSession.mockResolvedValue(sessionAs("admin", { role: "site", projectId: PROJECT_ID }));

    await expectError(await get(), 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.getBillDetail).not.toHaveBeenCalled();
  });

  it("returns 403 for a project the user cannot access, with no read and no PDF link", async () => {
    h.requireSession.mockResolvedValue(sessionAs("client"));
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    await expectError(await get(), 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.getBillDetail).not.toHaveBeenCalled();
    expectNoBillData();
  });

  it("answers every hidden-bill case identically — missing, deleted, other project, client draft, malformed", async () => {
    const bodies: string[] = [];
    const statuses: number[] = [];
    const record = async (res: Response) => {
      statuses.push(res.status);
      bodies.push(await res.text());
    };

    // Missing, or soft-deleted (the shared query returns none either way).
    h.requireSession.mockResolvedValue(sessionAs("client"));
    h.getBillDetail.mockResolvedValue(null);
    await record(await get());
    // Of another project.
    h.getBillDetail.mockResolvedValue(detailFor("client", { projectId: OTHER_PROJECT_ID }));
    await record(await get());
    // A draft, to a client.
    h.getBillDetail.mockResolvedValue(detailFor("client", { status: "draft" }));
    await record(await get());
    // Not an id at all.
    await record(await get(PROJECT_ID, "not-a-uuid"));

    expect(statuses).toEqual([404, 404, 404, 404]);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0] ?? "{}")).toEqual({
      error: "NOT_FOUND",
      message: "This bill isn't available.",
    });
    expect(h.getBillPdfUrl).not.toHaveBeenCalled();
  });

  it("returns 404 while BILLING_ENABLED is off", async () => {
    h.env.BILLING_ENABLED = false;

    await expectError(await get(), 404, "NOT_FOUND", "Billing isn't available yet.");
    expect(h.getBillDetail).not.toHaveBeenCalled();
    expectNoBillData();
  });

  it("returns 500 with a reference when the PDF lookup fails, never the raw message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.getBillPdfUrl.mockRejectedValue(new Error('permission denied for table "attachments"'));

    const res = await get();

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    consoleError.mockRestore();
  });

  it("maps a domain error from the helpers through the shared mapper (FORBIDDEN → 403)", async () => {
    h.getBillDetail.mockRejectedValue(new Error("FORBIDDEN: not allowed"));

    await expectError(await get(), 403, "FORBIDDEN", "You don't have permission to do that.");
  });
});
