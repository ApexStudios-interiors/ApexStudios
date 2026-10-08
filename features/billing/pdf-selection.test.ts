import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * getCurrentBillPdfKey — which of a bill's attachments is its invoice PDF —
 * against a fake client that applies the query's own filters to a set of
 * attachment rows, so the selection itself is exercised, not just the call
 * shape. The rule: the PDF named billPdfFileName(bill_no, current revision)
 * (the bill.pdf job's own name and idempotency key); newest of that name; an
 * uploaded copy or a superseded revision is never served; a bill the caller
 * cannot see (deleted for admin, or not in v_bill_client) has no PDF.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  bills: [] as Row[],
  clientBills: [] as Row[],
  attachments: [] as Row[],
  tables: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/r2/presign", () => ({ presignGet: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      h.tables.push(table);
      const source = table === "bills" ? h.bills : table === "v_bill_client" ? h.clientBills : h.attachments;
      let rows = [...source];
      let desc: string | null = null;
      const chain = {
        select: () => chain,
        eq: (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), chain),
        is: (col: string, v: unknown) => ((rows = rows.filter((r) => (r[col] ?? null) === v)), chain),
        order: (col: string, opts: { ascending: boolean }) => ((desc = opts.ascending ? null : col), chain),
        limit: (n: number) => {
          if (desc) {
            const c = desc;
            rows.sort((a, b) => String(b[c]).localeCompare(String(a[c])));
          }
          rows = rows.slice(0, n);
          return chain;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      };
      return chain;
    },
  }),
}));

const { getCurrentBillPdfKey } = await import("./queries");

const BILL_ID = "00000000-0000-4000-8000-0000000000e1";
const OTHER_BILL_ID = "00000000-0000-4000-8000-0000000000e2";

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

function pdf(fileName: string, createdAt: string, over: Row = {}): Row {
  return {
    entity_type: "bill",
    entity_id: BILL_ID,
    mime_type: "application/pdf",
    file_name: fileName,
    r2_key: `key/${fileName}@${createdAt}`,
    created_at: createdAt,
    deleted_at: null,
    ...over,
  };
}

function billAt(revision: number, over: Row = {}): Row {
  return { id: BILL_ID, bill_no: "RA-APX-001", revision, deleted_at: null, ...over };
}

beforeEach(() => {
  h.bills = [billAt(1)];
  h.clientBills = [billAt(1)];
  h.attachments = [];
  h.tables.length = 0;
});

describe("getCurrentBillPdfKey", () => {
  it("one generated PDF → that PDF", async () => {
    h.attachments = [pdf("RA-APX-001.pdf", "2026-10-01T10:00:00Z")];

    expect(await getCurrentBillPdfKey(sessionAs("admin"), BILL_ID)).toBe(
      "key/RA-APX-001.pdf@2026-10-01T10:00:00Z"
    );
  });

  it("an uploaded PDF copy added later is never served as the invoice", async () => {
    h.attachments = [
      pdf("RA-APX-001.pdf", "2026-10-01T10:00:00Z"),
      pdf("signed-scan.pdf", "2026-10-03T09:00:00Z"),
    ];

    expect(await getCurrentBillPdfKey(sessionAs("client"), BILL_ID)).toBe(
      "key/RA-APX-001.pdf@2026-10-01T10:00:00Z"
    );
  });

  it("after a rejection and resubmission → the current revision's PDF, not the superseded one", async () => {
    h.bills = [billAt(2)];
    h.clientBills = [billAt(2)];
    h.attachments = [
      pdf("RA-APX-001.pdf", "2026-10-01T10:00:00Z"),
      pdf("RA-APX-001-R2.pdf", "2026-10-05T10:00:00Z"),
    ];

    expect(await getCurrentBillPdfKey(sessionAs("client"), BILL_ID)).toBe(
      "key/RA-APX-001-R2.pdf@2026-10-05T10:00:00Z"
    );
  });

  it("current revision not rendered yet → none, never the stale revision-1 PDF", async () => {
    h.bills = [billAt(2)];
    h.clientBills = [billAt(2)];
    h.attachments = [pdf("RA-APX-001.pdf", "2026-10-01T10:00:00Z"), pdf("scan.pdf", "2026-10-06T10:00:00Z")];

    expect(await getCurrentBillPdfKey(sessionAs("client"), BILL_ID)).toBeNull();
  });

  it("several rows of the current name → the newest of them", async () => {
    h.attachments = [
      pdf("RA-APX-001.pdf", "2026-10-01T10:00:00Z"),
      pdf("RA-APX-001.pdf", "2026-10-02T10:00:00Z"),
    ];

    expect(await getCurrentBillPdfKey(sessionAs("admin"), BILL_ID)).toBe(
      "key/RA-APX-001.pdf@2026-10-02T10:00:00Z"
    );
  });

  it("ignores deleted rows, other bills, other entity types and non-PDFs of the same name", async () => {
    h.attachments = [
      pdf("RA-APX-001.pdf", "2026-10-04T10:00:00Z", { deleted_at: "2026-10-04T11:00:00Z" }),
      pdf("RA-APX-001.pdf", "2026-10-04T10:00:00Z", { entity_id: OTHER_BILL_ID }),
      pdf("RA-APX-001.pdf", "2026-10-04T10:00:00Z", { entity_type: "approval" }),
      pdf("RA-APX-001.pdf", "2026-10-04T10:00:00Z", { mime_type: "image/jpeg" }),
      pdf("RA-APX-001.pdf", "2026-10-01T10:00:00Z"),
    ];

    expect(await getCurrentBillPdfKey(sessionAs("admin"), BILL_ID)).toBe(
      "key/RA-APX-001.pdf@2026-10-01T10:00:00Z"
    );
  });

  it("no PDF at all → null", async () => {
    expect(await getCurrentBillPdfKey(sessionAs("admin"), BILL_ID)).toBeNull();
  });

  it("admin: a soft-deleted bill has no PDF, and attachments are not even read", async () => {
    h.bills = [billAt(1, { deleted_at: "2026-10-05T00:00:00Z" })];
    h.attachments = [pdf("RA-APX-001.pdf", "2026-10-01T10:00:00Z")];

    expect(await getCurrentBillPdfKey(sessionAs("admin"), BILL_ID)).toBeNull();
    expect(h.tables).toEqual(["bills"]);
  });

  it("client: reads the bill through v_bill_client only; a bill the view hides has no PDF", async () => {
    h.clientBills = [];
    h.attachments = [pdf("RA-APX-001.pdf", "2026-10-01T10:00:00Z")];

    expect(await getCurrentBillPdfKey(sessionAs("client"), BILL_ID)).toBeNull();
    expect(h.tables).toEqual(["v_bill_client"]);
    expect(h.tables).not.toContain("bills");
  });
});
