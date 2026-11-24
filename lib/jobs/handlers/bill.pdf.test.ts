import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * bill.pdf with the service_role client, R2 and the PDF renderer faked. Pins:
 * the payload contract, idempotency per (bill, revision) file name (AGENTS.md
 * background job rule 1), the happy path (render -> PUT -> attachment row)
 * and — the one rule that matters most — that the selects never name an
 * internal cost or margin column, even server-side, for a document a client
 * will read.
 */

type Result = { data: unknown; error: { message: string } | null };
type Call = { table: string; op: "select" | "insert"; arg: unknown; filters: [string, unknown][] };

const h = vi.hoisted(() => ({
  results: new Map<string, Result>(),
  calls: [] as Call[],
  send: vi.fn(),
  renderToBuffer: vi.fn(),
  billDocument: vi.fn(),
}));

function resultFor(table: string, op: string): Result {
  return h.results.get(`${table}.${op}`) ?? { data: null, error: null };
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { R2_BUCKET: "app-bucket" } }));
vi.mock("@/lib/r2/client", () => ({ r2Client: () => ({ send: h.send }) }));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: h.renderToBuffer }));
vi.mock("@/features/billing/components/BillDocument", () => ({ BillDocument: h.billDocument }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder = (op: "select" | "insert", arg: unknown) => {
        const call: Call = { table, op, arg, filters: [] };
        h.calls.push(call);
        const chain = {
          eq: (col: string, val: unknown) => {
            call.filters.push([col, val]);
            return chain;
          },
          is: (col: string, val: unknown) => {
            call.filters.push([col, val]);
            return chain;
          },
          order: () => chain,
          maybeSingle: async () => resultFor(table, op),
          single: async () => resultFor(table, op),
          then: (resolve: (r: Result) => unknown) => resolve(resultFor(table, op)),
        };
        return chain;
      };
      return {
        select: (cols: string) => builder("select", cols),
        insert: (row: unknown) => builder("insert", row),
      };
    },
  }),
}));

const { generateBillPdf } = await import("./bill.pdf");

const BILL_ID = "00000000-0000-4000-8000-000000000401";
const ORG = "00000000-0000-4000-8000-0000000000a0";
const PROJECT = "00000000-0000-4000-8000-0000000000c1";
const ADMIN = "00000000-0000-4000-8000-0000000000d2";

const BILL = {
  id: BILL_ID,
  org_id: ORG,
  project_id: PROJECT,
  // An issued bill: the handler renders only those (billHasInvoice, APX-35).
  status: "submitted",
  bill_no: "RA-BHEL-NCH-01",
  revision: 0,
  bill_date: "2026-11-01",
  period_from: "2026-10-01",
  period_to: "2026-10-31",
  work_value: 100000,
  material_value: 0,
  gross_amount: 100000,
  mas_recovery_amount: 0,
  taxable_amount: 100000,
  gst_amount: 18000,
  gst_rate_pct: 18,
  invoice_total: 118000,
  retention_amount: 5000,
  retention_pct: 5,
  tds_amount: 0,
  tds_pct: 0,
  advance_recovery: 0,
  net_payable: 113000,
  submitted_by: ADMIN,
  created_by: ADMIN,
};

beforeEach(() => {
  h.calls.length = 0;
  h.results.clear();
  h.results.set("bills.select", { data: BILL, error: null });
  h.results.set("attachments.select", { data: null, error: null });
  h.results.set("bill_lines.select", {
    data: [{ description: "Phase 1", client_value: 100000, pct_billed: 100, amount: 100000 }],
    error: null,
  });
  h.results.set("projects.select", { data: { client_id: "c" }, error: null });
  h.results.set("orgs.select", {
    data: {
      legal_name: "Apex",
      gstin: "G",
      pan: "P",
      address: "A",
      bank_name: "B",
      bank_account_no: "1",
      bank_ifsc: "I",
    },
    error: null,
  });
  h.results.set("clients.select", {
    data: { name: "BHEL", gstin: null, billing_address: null },
    error: null,
  });
  h.results.set("attachments.insert", { data: null, error: null });
  h.send.mockReset();
  h.send.mockResolvedValue({});
  h.renderToBuffer.mockReset();
  h.renderToBuffer.mockResolvedValue(Buffer.from("%PDF-fake"));
  h.billDocument.mockReset();
  h.billDocument.mockReturnValue({});
});

function selectOf(table: string): string {
  const call = h.calls.find((c) => c.table === table && c.op === "select");
  if (!call || typeof call.arg !== "string") throw new Error(`no select on ${table}`);
  return call.arg;
}

describe("bill.pdf", () => {
  it("throws when the payload has no billId", async () => {
    await expect(generateBillPdf({})).rejects.toThrow(/missing billId/);
    expect(h.calls).toHaveLength(0);
  });

  it("throws NOT_FOUND for a bill that does not exist", async () => {
    h.results.set("bills.select", { data: null, error: null });
    await expect(generateBillPdf({ billId: BILL_ID })).rejects.toThrow(/^NOT_FOUND/);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("throws the database error when the bill read fails", async () => {
    h.results.set("bills.select", { data: null, error: { message: "db down" } });
    await expect(generateBillPdf({ billId: BILL_ID })).rejects.toThrow("db down");
  });

  it("is idempotent: an existing PDF for this revision short-circuits with no render or upload", async () => {
    h.results.set("attachments.select", { data: { id: "att-1" }, error: null });
    await generateBillPdf({ billId: BILL_ID });

    expect(h.renderToBuffer).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.calls.some((c) => c.op === "insert")).toBe(false);
    const lookup = h.calls.find((c) => c.table === "attachments" && c.op === "select");
    expect(lookup?.filters).toEqual(
      expect.arrayContaining([
        ["entity_type", "bill"],
        ["entity_id", BILL_ID],
        ["deleted_at", null],
      ])
    );
  });

  it("renders, uploads to R2 and records an attachment row", async () => {
    await generateBillPdf({ billId: BILL_ID });

    expect(h.renderToBuffer).toHaveBeenCalledTimes(1);
    expect(h.billDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refNo: "RA-BHEL-NCH-01", netPayable: 113000 }),
      })
    );

    expect(h.send).toHaveBeenCalledTimes(1);
    const put = h.send.mock.calls[0]?.[0] as {
      constructor: { name: string };
      input: Record<string, unknown>;
    };
    expect(put.constructor.name).toBe("PutObjectCommand");
    expect(put.input).toMatchObject({ Bucket: "app-bucket", ContentType: "application/pdf" });
    const key = String(put.input.Key);
    expect(key.startsWith(`org/${ORG}/project/${PROJECT}/bill/${BILL_ID}/`)).toBe(true);

    const insert = h.calls.find((c) => c.table === "attachments" && c.op === "insert");
    expect(insert?.arg).toMatchObject({
      org_id: ORG,
      project_id: PROJECT,
      entity_type: "bill",
      entity_id: BILL_ID,
      r2_key: key,
      mime_type: "application/pdf",
      size_bytes: Buffer.from("%PDF-fake").byteLength,
      uploaded_by: ADMIN,
    });
  });

  it("never selects an internal cost or margin column", async () => {
    await generateBillPdf({ billId: BILL_ID });
    const bills = selectOf("bills");
    expect(bills).not.toMatch(/internal_cost_amount|margin_amount|internal/);
    const lines = selectOf("bill_lines");
    expect(lines).not.toMatch(/internal_cost|internal/);
  });

  it("throws when recording the attachment fails", async () => {
    h.results.set("attachments.insert", { data: null, error: { message: "insert refused" } });
    await expect(generateBillPdf({ billId: BILL_ID })).rejects.toThrow("insert refused");
  });

  it("throws when a related read fails, before rendering anything", async () => {
    h.results.set("orgs.select", { data: null, error: { message: "org read failed" } });
    await expect(generateBillPdf({ billId: BILL_ID })).rejects.toThrow("org read failed");
    expect(h.renderToBuffer).not.toHaveBeenCalled();
  });
});
