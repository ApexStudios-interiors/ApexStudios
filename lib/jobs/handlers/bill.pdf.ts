import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { r2Client } from "@/lib/r2/client";
import { buildAttachmentKey } from "@/lib/r2/keys";
import { createAdminClient } from "@/lib/supabase/admin";
import { BillDocument, type BillPdfData } from "@/features/billing/components/BillDocument";
import { billPdfFileName } from "@/features/billing/pdf";

/**
 * build/09-billing.md §4.6. Enqueued on draft -> submitted
 * (features/billing/actions.ts). SLO: available within 60 seconds of
 * submission (architecture.md §8.1) — if this job fails, the bill is still
 * Submitted and certifiable regardless; the PDF appears on retry
 * (architecture.md §8.4), it is never a blocker for the client's own
 * certification step.
 *
 * Reads `bills`/`bill_lines` via the service_role admin client (a
 * background job has no user session — this is the documented
 * lib/jobs/handlers/** carve-out from D11, not an RLS bypass in a request
 * path) but selects ONLY the client-facing columns: never
 * internal_cost_amount, margin_amount or bill_lines.internal_cost. The
 * "never internal cost or margin" rule holds even server-side, for a
 * document a client will actually read.
 */
export async function generateBillPdf(payload: unknown): Promise<void> {
  const billId = (payload as { billId?: string }).billId;
  if (!billId) throw new Error("bill.pdf payload is missing billId");

  const supabase = createAdminClient();

  const { data: bill, error: billErr } = await supabase
    .from("bills")
    .select(
      "id, org_id, project_id, bill_no, revision, bill_date, period_from, period_to, work_value, material_value, gross_amount, mas_recovery_amount, taxable_amount, gst_amount, gst_rate_pct, invoice_total, retention_amount, retention_pct, tds_amount, tds_pct, advance_recovery, net_payable, submitted_by, created_by"
    )
    .eq("id", billId)
    .maybeSingle();
  if (billErr) throw new Error(billErr.message);
  if (!bill) throw new Error(`NOT_FOUND: bill ${billId} does not exist`);

  // The file name carries the bill's own revision (features/billing/pdf.ts),
  // and is read from the bill row rather than the job payload so a job
  // claimed after a further rejection renders the revision that actually
  // exists now. Nothing here recomputes a figure: the columns selected above
  // were snapshotted by `rpc_create_bill` and are immutable from `submitted`
  // onward (AGENTS.md billing rules) — a regenerated PDF restates nothing,
  // it re-renders the same stored numbers onto a document whose live parts
  // (Apex's and the client's own GSTIN/address/bank block) may since have
  // been corrected.
  const fileName = billPdfFileName(bill.bill_no, bill.revision);

  // Idempotent (AGENTS.md background job rule 1): a job retried after a
  // partial failure (e.g. the render succeeded but the R2 upload didn't)
  // should not leave two PDF attachments behind. Scoped to THIS revision's
  // own file name — the previous revision's document stays on the bill as
  // the record of what the client was shown before, and `getBillPdfUrl`
  // serves the newest.
  const { data: existing, error: existingErr } = await supabase
    .from("attachments")
    .select("id")
    .eq("entity_type", "bill")
    .eq("entity_id", billId)
    .eq("file_name", fileName)
    .is("deleted_at", null)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);
  if (existing) return;

  const [
    { data: lines, error: linesErr },
    { data: project, error: projectErr },
    { data: org, error: orgErr },
  ] = await Promise.all([
    supabase
      .from("bill_lines")
      .select("description, client_value, pct_billed, amount")
      .eq("bill_id", billId)
      .order("sort_order", { ascending: true }),
    supabase.from("projects").select("client_id").eq("id", bill.project_id).single(),
    supabase
      .from("orgs")
      .select("legal_name, gstin, pan, address, bank_name, bank_account_no, bank_ifsc")
      .eq("id", bill.org_id)
      .single(),
  ]);
  if (linesErr) throw new Error(linesErr.message);
  if (projectErr) throw new Error(projectErr.message);
  if (orgErr) throw new Error(orgErr.message);

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("name, gstin, billing_address")
    .eq("id", project.client_id)
    .single();
  if (clientErr) throw new Error(clientErr.message);

  const pdfData: BillPdfData = {
    refNo: bill.bill_no,
    billDate: bill.bill_date,
    periodFrom: bill.period_from,
    periodTo: bill.period_to,
    org: {
      legalName: org.legal_name ?? "",
      gstin: org.gstin ?? "",
      pan: org.pan ?? "",
      address: org.address ?? "",
      bankName: org.bank_name ?? "",
      bankAccountNo: org.bank_account_no ?? "",
      bankIfsc: org.bank_ifsc ?? "",
    },
    client: {
      name: client.name,
      gstin: client.gstin ?? "",
      billingAddress: client.billing_address ?? "",
    },
    lines: lines.map((l) => ({
      description: l.description,
      clientValue: Number(l.client_value),
      pctBilled: Number(l.pct_billed),
      amount: Number(l.amount),
    })),
    workValue: Number(bill.work_value),
    materialValue: Number(bill.material_value),
    grossAmount: Number(bill.gross_amount),
    masRecoveryAmount: Number(bill.mas_recovery_amount),
    taxableAmount: Number(bill.taxable_amount),
    gstAmount: Number(bill.gst_amount),
    gstRatePct: Number(bill.gst_rate_pct),
    invoiceTotal: Number(bill.invoice_total),
    retentionAmount: Number(bill.retention_amount),
    retentionPct: Number(bill.retention_pct),
    tdsAmount: Number(bill.tds_amount),
    tdsPct: Number(bill.tds_pct),
    advanceRecovery: Number(bill.advance_recovery),
    netPayable: Number(bill.net_payable),
  };

  const pdfBuffer = await renderToBuffer(BillDocument({ data: pdfData }));

  const key = buildAttachmentKey({
    orgId: bill.org_id,
    projectId: bill.project_id,
    entityType: "bill",
    entityId: billId,
    fileName,
  });

  await r2Client().send(
    new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: pdfBuffer, ContentType: "application/pdf" })
  );

  const { error: insertErr } = await supabase.from("attachments").insert({
    org_id: bill.org_id,
    project_id: bill.project_id,
    entity_type: "bill",
    entity_id: billId,
    r2_key: key,
    file_name: fileName,
    mime_type: "application/pdf",
    size_bytes: pdfBuffer.byteLength,
    // The admin who submitted this bill is the closest real "author" of the
    // document a job generates on their behalf; created_by is the fallback
    // for the (should-be-impossible) case submitted_by is somehow null.
    uploaded_by: bill.submitted_by ?? bill.created_by,
  });
  if (insertErr) throw new Error(insertErr.message);
}
