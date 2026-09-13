import "server-only";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * build/09-billing.md §4.7: "exceljs, streamed directly from a route
 * handler on request — not a job." Admin only (`02-lld.md §7`: "pdf: any
 * member · xlsx: admin") — the guard is here, in the route itself, not
 * layered on top of a shared export action. This is the accounting
 * hand-off (Tally/Zoho stay external, a human moves the file,
 * system-overview.md §2): the workbook carries cost and margin, which a
 * client export never would.
 *
 * The exact columns Apex's own data-entry workflow needs are still an open
 * question (build's own "ask whoever does Apex's data entry" — nobody has
 * yet); this shape is a reasonable best-effort covering every figure the
 * bill itself stores, not a confirmed accounting template.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ billId: string }> }) {
  if (!env.BILLING_ENABLED) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  try {
    await requireRole(["owner", "admin"]);
  } catch (e) {
    if (e instanceof UnauthenticatedError)
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    throw e;
  }
  const { billId } = await params;

  const supabase = await createClient();
  const { data: bill, error: billErr } = await supabase
    .from("bills")
    .select(
      "id, bill_no, bill_date, period_from, period_to, status, work_value, material_value, gross_amount, mas_recovery_amount, taxable_amount, gst_amount, gst_rate_pct, invoice_total, retention_amount, retention_pct, tds_amount, tds_pct, advance_recovery, net_payable, internal_cost_amount, margin_amount, project_id"
    )
    .eq("id", billId)
    .is("deleted_at", null)
    .maybeSingle();
  if (billErr) return NextResponse.json({ error: billErr.message }, { status: 500 });
  if (!bill) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const [{ data: lines, error: linesErr }, { data: project, error: projectErr }] = await Promise.all([
    supabase
      .from("bill_lines")
      .select("description, source_type, client_value, pct_billed, amount, internal_cost")
      .eq("bill_id", billId)
      .order("sort_order", { ascending: true }),
    supabase.from("projects").select("name, code, client_id").eq("id", bill.project_id).single(),
  ]);
  if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 });
  if (projectErr) return NextResponse.json({ error: projectErr.message }, { status: 500 });

  const { data: client } = await supabase.from("clients").select("name").eq("id", project.client_id).single();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Apex Projects";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Bill");
  summary.columns = [
    { header: "Field", key: "field", width: 28 },
    { header: "Value", key: "value", width: 32 },
  ];
  summary.addRows([
    { field: "Bill No", value: bill.bill_no },
    { field: "Project", value: `${project.code} — ${project.name}` },
    { field: "Client", value: client?.name ?? "" },
    { field: "Bill Date", value: bill.bill_date },
    { field: "Period From", value: bill.period_from ?? "" },
    { field: "Period To", value: bill.period_to ?? "" },
    { field: "Status", value: bill.status },
    { field: "A — Work Value", value: Number(bill.work_value) },
    { field: "B — Material Value", value: Number(bill.material_value) },
    { field: "C — Gross (A+B)", value: Number(bill.gross_amount) },
    { field: "D — MAS Recovery", value: Number(bill.mas_recovery_amount) },
    { field: "E — Taxable (C-D)", value: Number(bill.taxable_amount) },
    { field: `F — GST @ ${bill.gst_rate_pct}%`, value: Number(bill.gst_amount) },
    { field: "G — Invoice Total (E+F)", value: Number(bill.invoice_total) },
    { field: `H — Retention @ ${bill.retention_pct}%`, value: Number(bill.retention_amount) },
    { field: `I — TDS @ ${bill.tds_pct}% (informational)`, value: Number(bill.tds_amount) },
    { field: "J — Advance Recovery", value: Number(bill.advance_recovery) },
    { field: "K — Net Payable (G-H-I-J)", value: Number(bill.net_payable) },
    { field: "Internal Cost (admin only)", value: Number(bill.internal_cost_amount) },
    { field: "Margin (admin only)", value: Number(bill.margin_amount) },
  ]);

  const lineSheet = workbook.addWorksheet("Line Items");
  lineSheet.columns = [
    { header: "Description", key: "description", width: 50 },
    { header: "Type", key: "sourceType", width: 12 },
    { header: "Client Value", key: "clientValue", width: 16 },
    { header: "% Billed", key: "pctBilled", width: 10 },
    { header: "Amount", key: "amount", width: 16 },
    { header: "Internal Cost", key: "internalCost", width: 16 },
    { header: "Margin", key: "margin", width: 16 },
  ];
  for (const l of lines) {
    lineSheet.addRow({
      description: l.description,
      sourceType: l.source_type,
      clientValue: Number(l.client_value),
      pctBilled: Number(l.pct_billed),
      amount: Number(l.amount),
      internalCost: Number(l.internal_cost),
      margin: Number(l.amount) - Number(l.internal_cost),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${bill.bill_no}.xlsx"`,
    },
  });
}
