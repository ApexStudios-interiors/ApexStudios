import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireSession, type Session } from "@/lib/auth/session";
import { presignGet } from "@/lib/r2/presign";
import { fetchPage, type Page, type PageRequest } from "@/lib/pagination";

/**
 * build/09-billing.md §4.4. `v_billable_now` and `v_bill_client` both
 * predate this build (Build 07's own "built ahead of need" views) — this
 * file wires them up, it does not define them.
 */

export type BillableNowLine = {
  sourceType: "phase" | "material";
  sourceId: string;
  description: string;
  clientValue: number;
  pctBilled: number;
  amount: number;
  internalCost: number;
  /** Feeds `previewBill`'s own `priorMaterialAdvanceOnThisPhase` — only
   *  meaningful on a phase line. Computed here, not in the browser, so the
   *  client-side preview agrees with `rpc_create_bill`'s own step 5. */
  priorMaterialAdvanceOnThisPhase: number;
};

/** Admin only (`v_billable_now`'s own RLS-invoker policies already enforce
 *  this — a non-admin session simply sees the base tables it joins refuse
 *  it). Attaches each phase line's own prior-MAS-advance figure so the
 *  Billable Now selector's running total (features/billing/service.ts)
 *  matches `rpc_create_bill`'s own step 5 exactly. */
export async function getBillableNow(projectId: string): Promise<BillableNowLine[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_billable_now")
    .select("source_type, source_id, description, client_value, pct_billed, amount, internal_cost")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  // v_billable_now's own two branches always populate source_type/source_id
  // (neither union member ever emits one without the other) — filtering the
  // rare defensive null out here is simpler than threading `| null` through
  // every consumer of a row that cannot actually occur.
  const rows = data.filter(
    (r): r is typeof r & { source_type: "phase" | "material"; source_id: string; description: string } =>
      r.source_type != null && r.source_id != null && r.description != null
  );

  const phaseIds = rows.filter((r) => r.source_type === "phase").map((r) => r.source_id);
  const priorAdvanceByPhase = new Map<string, number>();
  if (phaseIds.length > 0) {
    // bill_lines.source_id is a polymorphic reference (a phase id or a
    // stock_request id depending on source_type) with no declared foreign
    // key — PostgREST can't embed across it, so this is two plain queries
    // joined client-side rather than one embedded select.
    const { data: srRows, error: srErr } = await supabase
      .from("stock_requests")
      .select("id, phase_id")
      .in("phase_id", phaseIds);
    if (srErr) throw new Error(srErr.message);
    const phaseIdByStockRequest = new Map(srRows.map((sr) => [sr.id, sr.phase_id as string]));

    if (srRows.length > 0) {
      const { data: priorLines, error: priorErr } = await supabase
        .from("bill_lines")
        .select("source_id, amount")
        .eq("source_type", "material")
        .in(
          "source_id",
          srRows.map((sr) => sr.id)
        );
      if (priorErr) throw new Error(priorErr.message);
      for (const line of priorLines) {
        const phaseId = line.source_id ? phaseIdByStockRequest.get(line.source_id) : undefined;
        if (phaseId)
          priorAdvanceByPhase.set(phaseId, (priorAdvanceByPhase.get(phaseId) ?? 0) + Number(line.amount));
      }
    }
  }

  return rows.map((r) => ({
    sourceType: r.source_type,
    sourceId: r.source_id,
    description: r.description,
    clientValue: Number(r.client_value),
    pctBilled: Number(r.pct_billed),
    amount: Number(r.amount),
    internalCost: Number(r.internal_cost),
    priorMaterialAdvanceOnThisPhase:
      r.source_type === "phase" ? (priorAdvanceByPhase.get(r.source_id) ?? 0) : 0,
  }));
}

export type BillLineDTO = {
  id: string;
  sourceType: "phase" | "material" | "manual" | "adjustment";
  description: string;
  clientValue: number;
  pctBilled: number;
  amount: number;
  /** Present only in the admin shape — never selected for a client. */
  internalCost?: number;
};

export type BillDTO = {
  id: string;
  projectId: string;
  refNo: string;
  billDate: string;
  periodFrom: string | null;
  periodTo: string | null;
  status: "draft" | "submitted" | "certified" | "paid" | "cancelled";
  revision: number;
  workValue: number;
  materialValue: number;
  grossAmount: number;
  masRecoveryAmount: number;
  taxableAmount: number;
  gstAmount: number;
  invoiceTotal: number;
  retentionAmount: number;
  tdsAmount: number;
  advanceRecovery: number;
  netPayable: number;
  gstRatePct: number;
  retentionPct: number;
  tdsPct: number;
  notes: string | null;
  submittedAt: string | null;
  certifiedAt: string | null;
  certificationNote: string | null;
  paidAt: string | null;
  createdAt: string;
  /** ADMIN ONLY. Absent entirely from the client's own DTO — never fetched
   *  for that role in the first place (AGENTS.md's own rule), not merely
   *  hidden in the UI. */
  internalCostAmount?: number;
  marginAmount?: number;
  /** Distinct package names this bill's lines touch (ui-guide §6.11's own
   *  "Packages" column). Empty on the bill-detail shape (not needed there);
   *  populated for the bill LIST functions — see `packageLabelsByBill`'s
   *  own comment for why the admin and client paths differ. */
  packageLabels: string[];
};

const ADMIN_BILL_COLUMNS =
  "id, project_id, bill_no, bill_date, period_from, period_to, status, revision, work_value, material_value, gross_amount, mas_recovery_amount, taxable_amount, gst_amount, invoice_total, retention_amount, tds_amount, advance_recovery, net_payable, gst_rate_pct, retention_pct, tds_pct, notes, submitted_at, certified_at, certification_note, paid_at, created_at, internal_cost_amount, margin_amount";

const CLIENT_BILL_COLUMNS =
  "id, project_id, bill_no, bill_date, period_from, period_to, status, revision, work_value, material_value, gross_amount, mas_recovery_amount, taxable_amount, gst_amount, invoice_total, retention_amount, tds_amount, advance_recovery, net_payable, gst_rate_pct, retention_pct, tds_pct, notes, submitted_at, certified_at, certification_note, paid_at, created_at";

type AdminBillRow = {
  id: string;
  project_id: string;
  bill_no: string;
  bill_date: string;
  period_from: string | null;
  period_to: string | null;
  status: BillDTO["status"];
  revision: number;
  work_value: number;
  material_value: number;
  gross_amount: number;
  mas_recovery_amount: number;
  taxable_amount: number;
  gst_amount: number;
  invoice_total: number;
  retention_amount: number;
  tds_amount: number;
  advance_recovery: number;
  net_payable: number;
  gst_rate_pct: number;
  retention_pct: number;
  tds_pct: number;
  notes: string | null;
  submitted_at: string | null;
  certified_at: string | null;
  certification_note: string | null;
  paid_at: string | null;
  created_at: string;
  internal_cost_amount?: number;
  margin_amount?: number;
};

async function paidByBill(billIds: string[]): Promise<Map<string, number>> {
  if (billIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("payments").select("bill_id, amount").in("bill_id", billIds);
  if (error) throw new Error(error.message);
  const map = new Map<string, number>();
  for (const p of data) map.set(p.bill_id, (map.get(p.bill_id) ?? 0) + Number(p.amount));
  return map;
}

/**
 * ui-guide §6.11's "Packages" column — the distinct package names each
 * bill's own lines touch. Two genuinely different paths, not one branch on
 * top of a shared query:
 *
 * Admin reads `bill_lines` directly (source_id included) and resolves each
 * phase/stock_request's own package_id, then `packages` for the name —
 * package names carry no money, but `packages` is still an admin-only base
 * table (Build 04), so this whole path only ever runs for an admin session.
 *
 * A client's own `v_bill_line_client` deliberately OMITS `source_id`
 * ("withheld because it identifies the exact phase or stock request behind
 * the line, which lets a determined client correlate cost across bills" —
 * that view's own comment) — there is no id to resolve a package through.
 * Its `description` already carries the package name inline for a phase
 * line (`v_billable_now`'s own "{package} — {phase}" format); a material
 * line's description never names a package at all, so a client's own
 * "Packages" column is honestly whatever phase lines a bill has, not a
 * complete picture — the same shape the shared bill detail dialog already
 * gives a client for line items generally.
 */
async function packageLabelsByBill(billIds: string[], isAdmin: boolean): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (billIds.length === 0) return result;
  const supabase = await createClient();

  if (!isAdmin) {
    const { data, error } = await supabase
      .from("v_bill_line_client")
      .select("bill_id, description")
      .in("bill_id", billIds);
    if (error) throw new Error(error.message);
    for (const line of data) {
      if (!line.bill_id || !line.description?.includes(" — ")) continue;
      const name = line.description.split(" — ")[0]?.trim();
      if (!name) continue;
      const existing = result.get(line.bill_id) ?? [];
      if (!existing.includes(name)) existing.push(name);
      result.set(line.bill_id, existing);
    }
    return result;
  }

  const { data: lineRows, error: lineErr } = await supabase
    .from("bill_lines")
    .select("bill_id, source_type, source_id")
    .in("bill_id", billIds);
  if (lineErr) throw new Error(lineErr.message);

  const phaseSourceIds = lineRows
    .filter((l) => l.source_type === "phase")
    .map((l) => l.source_id)
    .filter((id): id is string => id != null);
  const materialSourceIds = lineRows
    .filter((l) => l.source_type === "material")
    .map((l) => l.source_id)
    .filter((id): id is string => id != null);

  const packageIdByPhase = new Map<string, string>();
  if (phaseSourceIds.length > 0) {
    const { data, error } = await supabase.from("phases").select("id, package_id").in("id", phaseSourceIds);
    if (error) throw new Error(error.message);
    for (const p of data) if (p.package_id) packageIdByPhase.set(p.id, p.package_id);
  }
  const packageIdByStockRequest = new Map<string, string>();
  if (materialSourceIds.length > 0) {
    const { data, error } = await supabase
      .from("stock_requests")
      .select("id, package_id")
      .in("id", materialSourceIds);
    if (error) throw new Error(error.message);
    for (const s of data) if (s.package_id) packageIdByStockRequest.set(s.id, s.package_id);
  }

  const packageIds = [...new Set([...packageIdByPhase.values(), ...packageIdByStockRequest.values()])];
  const packageNameById = new Map<string, string>();
  if (packageIds.length > 0) {
    const { data, error } = await supabase.from("packages").select("id, name").in("id", packageIds);
    if (error) throw new Error(error.message);
    for (const p of data) packageNameById.set(p.id, p.name);
  }

  for (const line of lineRows) {
    if (!line.source_id) continue;
    const packageId =
      line.source_type === "phase"
        ? packageIdByPhase.get(line.source_id)
        : packageIdByStockRequest.get(line.source_id);
    const name = packageId ? packageNameById.get(packageId) : undefined;
    if (!name) continue;
    const existing = result.get(line.bill_id) ?? [];
    if (!existing.includes(name)) existing.push(name);
    result.set(line.bill_id, existing);
  }
  return result;
}

function toBillDTO(r: AdminBillRow, admin: boolean, packageLabels: string[]): BillDTO {
  const netPayable = Number(r.net_payable);
  return {
    id: r.id,
    projectId: r.project_id,
    refNo: r.bill_no,
    billDate: r.bill_date,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    status: r.status,
    revision: r.revision,
    workValue: Number(r.work_value),
    materialValue: Number(r.material_value),
    grossAmount: Number(r.gross_amount),
    masRecoveryAmount: Number(r.mas_recovery_amount),
    taxableAmount: Number(r.taxable_amount),
    gstAmount: Number(r.gst_amount),
    invoiceTotal: Number(r.invoice_total),
    retentionAmount: Number(r.retention_amount),
    tdsAmount: Number(r.tds_amount),
    advanceRecovery: Number(r.advance_recovery),
    netPayable,
    gstRatePct: Number(r.gst_rate_pct),
    retentionPct: Number(r.retention_pct),
    tdsPct: Number(r.tds_pct),
    notes: r.notes,
    submittedAt: r.submitted_at,
    certifiedAt: r.certified_at,
    certificationNote: r.certification_note,
    paidAt: r.paid_at,
    createdAt: r.created_at,
    ...(admin
      ? {
          internalCostAmount: Number(r.internal_cost_amount ?? 0),
          marginAmount: Number(r.margin_amount ?? 0),
        }
      : {}),
    packageLabels,
  };
}

/** Full table including margin. `bills`' own select policy is already
 *  admin-only (migration 0010) — a non-admin session gets zero rows, not an
 *  error, same as every other admin-only base table in this app. */
export async function getBillsForAdmin(projectId: string): Promise<BillDTO[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bills")
    .select(ADMIN_BILL_COLUMNS)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("seq_no", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data as AdminBillRow[];
  const labels = await packageLabelsByBill(
    rows.map((r) => r.id),
    true
  );
  return rows.map((r) => toBillDTO(r, true, labels.get(r.id) ?? []));
}

/** `v_bill_client` — no `internal_cost_amount`, no `margin_amount`, not
 *  present in the select list at all (build's own explicit instruction).
 *  No per-bill "outstanding" figure either: `payments` has no select policy
 *  for a client at all (migration 0010, admin only), and the client's own
 *  UI needs only the bucket a bill's status already gives it (ui-guide
 *  §6.11's client table has no Outstanding column). */
export async function getBillsForClient(projectId: string): Promise<BillDTO[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_bill_client")
    .select(CLIENT_BILL_COLUMNS)
    .eq("project_id", projectId)
    .order("seq_no", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data as AdminBillRow[];
  const labels = await packageLabelsByBill(
    rows.map((r) => r.id),
    false
  );
  return rows.map((r) => toBillDTO(r, false, labels.get(r.id) ?? []));
}

/** One page of the admin Bills table — `count: "exact"` + `.range()`
 *  (lib/pagination.ts), so the package labels are resolved for that page
 *  only. The stat row is NOT computed from it: `getAdminBillingStats` reads
 *  every bill, because "Billed to Date" is not a per-page figure. */
export async function getBillsPageForAdmin(projectId: string, req: PageRequest): Promise<Page<BillDTO>> {
  await requireSession();
  const supabase = await createClient();
  const page = await fetchPage(
    (from, to) =>
      supabase
        .from("bills")
        .select(ADMIN_BILL_COLUMNS, { count: "exact" })
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("seq_no", { ascending: false })
        .range(from, to),
    req
  );
  const rows = page.rows as AdminBillRow[];
  const labels = await packageLabelsByBill(
    rows.map((r) => r.id),
    true
  );
  return { ...page, rows: rows.map((r) => toBillDTO(r, true, labels.get(r.id) ?? [])) };
}

/** One page of the client Bills table. A draft bill has never been sent and
 *  the client table has never shown one — that filter moves into the query
 *  here, where it has to be, so the page and the count agree with the rows. */
export async function getBillsPageForClient(projectId: string, req: PageRequest): Promise<Page<BillDTO>> {
  await requireSession();
  const supabase = await createClient();
  const page = await fetchPage(
    (from, to) =>
      supabase
        .from("v_bill_client")
        .select(CLIENT_BILL_COLUMNS, { count: "exact" })
        .eq("project_id", projectId)
        .neq("status", "draft")
        .order("seq_no", { ascending: false })
        .range(from, to),
    req
  );
  const rows = page.rows as AdminBillRow[];
  const labels = await packageLabelsByBill(
    rows.map((r) => r.id),
    false
  );
  return { ...page, rows: rows.map((r) => toBillDTO(r, false, labels.get(r.id) ?? [])) };
}

export type BillDetail = {
  bill: BillDTO;
  lines: BillLineDTO[];
  billCopyUrls: { id: string; url: string; name: string }[];
};

async function fetchBillCopyUrls(billId: string): Promise<{ id: string; url: string; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attachments")
    .select("id, r2_key, file_name")
    .eq("entity_type", "bill")
    .eq("entity_id", billId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return Promise.all(
    data.map(async (a) => ({ id: a.id, url: await presignGet(a.r2_key, "attachment"), name: a.file_name }))
  );
}

type BillLineRow = {
  id: string;
  source_type: BillLineDTO["sourceType"];
  description: string;
  client_value: number;
  pct_billed: number;
  amount: number;
  internal_cost?: number;
};

/** Both shapes, branched on the effective role — a client's own detail
 *  fetch never runs the admin query in the first place. Two full,
 *  separately-typed branches rather than a ternaried `.from()`/`.select()`:
 *  the generated Supabase types resolve a table/view name and its own
 *  select-string columns together, so branching on the STRING breaks that
 *  resolution for both. */
export async function getBillDetail(session: Session, billId: string): Promise<BillDetail | null> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";
  const supabase = await createClient();

  let bill: BillDTO | null = null;
  let lineRows: BillLineRow[] = [];

  if (isAdmin) {
    const { data: billRow, error } = await supabase
      .from("bills")
      .select(ADMIN_BILL_COLUMNS)
      .eq("id", billId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!billRow) return null;
    bill = toBillDTO(billRow as AdminBillRow, true, []);

    const { data, error: lineErr } = await supabase
      .from("bill_lines")
      .select("id, source_type, description, client_value, pct_billed, amount, internal_cost")
      .eq("bill_id", billId)
      .order("sort_order", { ascending: true });
    if (lineErr) throw new Error(lineErr.message);
    lineRows = data as BillLineRow[];
  } else {
    const { data: billRow, error } = await supabase
      .from("v_bill_client")
      .select(CLIENT_BILL_COLUMNS)
      .eq("id", billId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!billRow) return null;
    bill = toBillDTO(billRow as AdminBillRow, false, []);

    const { data, error: lineErr } = await supabase
      .from("v_bill_line_client")
      .select("id, source_type, description, client_value, pct_billed, amount")
      .eq("bill_id", billId)
      .order("sort_order", { ascending: true });
    if (lineErr) throw new Error(lineErr.message);
    lineRows = data as BillLineRow[];
  }

  const lines: BillLineDTO[] = lineRows.map((l) => ({
    id: l.id,
    sourceType: l.source_type,
    description: l.description,
    clientValue: Number(l.client_value),
    pctBilled: Number(l.pct_billed),
    amount: Number(l.amount),
    ...(isAdmin ? { internalCost: Number(l.internal_cost ?? 0) } : {}),
  }));

  const billCopyUrls = await fetchBillCopyUrls(billId);
  return { bill, lines, billCopyUrls };
}

export type AdminBillingStats = {
  billedToDate: number;
  /** How many bills that figure covers. Counted here, over every bill, not
   *  in the component over whichever page of the table is showing. */
  billedCount: number;
  received: number;
  paidCount: number;
  outstanding: number;
  billableNowCount: number;
  billableNowValue: number;
};

/** Admin's own stat row (ui-guide §6.11) — distinct from the dashboard's
 *  mini "Bills Raised" summary (`getClientBillingStats`, features/projects),
 *  which is the client's shape, not this one.
 *
 *  Outstanding is `02-lld.md` §3.8's own formula, verbatim: "Σ
 *  bills.net_payable (certified, paid) − Σ payments.amount." Summing both
 *  certified AND paid bills' net_payable, then subtracting every payment
 *  against them, nets to exactly the unpaid remainder — a fully-paid bill's
 *  own payments already sum to its own net_payable, contributing zero. */
export async function getAdminBillingStats(projectId: string): Promise<AdminBillingStats> {
  await requireSession();
  const [bills, billable] = await Promise.all([getBillsForAdmin(projectId), getBillableNow(projectId)]);

  const billed = bills.filter((b) => b.status !== "draft");
  const paid = bills.filter((b) => b.status === "paid");
  const billedToDate = billed.reduce((a, b) => a + b.invoiceTotal, 0);
  const received = paid.reduce((a, b) => a + b.netPayable, 0);

  const certifiedOrPaid = bills.filter((b) => b.status === "certified" || b.status === "paid");
  const netPayableTotal = certifiedOrPaid.reduce((a, b) => a + b.netPayable, 0);
  const paidByCertifiedOrPaid = await paidByBill(certifiedOrPaid.map((b) => b.id));
  const paidTotal = [...paidByCertifiedOrPaid.values()].reduce((a, v) => a + v, 0);
  const outstanding = Math.max(netPayableTotal - paidTotal, 0);

  const billableNowValue = billable.reduce((a, l) => a + l.amount, 0);

  return {
    billedToDate,
    billedCount: billed.length,
    received,
    paidCount: paid.length,
    outstanding,
    billableNowCount: billable.length,
    billableNowValue,
  };
}

/** The Record Payment dialog's own "already paid X, Y remaining" figures —
 *  admin only (`payments` has no select policy for any other role). */
export async function getBillPaymentsSummary(billId: string): Promise<{
  paidSoFar: number;
  payments: { id: string; amount: number; paidOn: string; mode: string | null; referenceNo: string | null }[];
}> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .select("id, amount, paid_on, mode, reference_no")
    .eq("bill_id", billId)
    .order("paid_on", { ascending: false });
  if (error) throw new Error(error.message);
  const paidSoFar = data.reduce((a, p) => a + Number(p.amount), 0);
  return {
    paidSoFar,
    payments: data.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      paidOn: p.paid_on,
      mode: p.mode,
      referenceNo: p.reference_no,
    })),
  };
}

export type ClientBillsStats = {
  billsRaised: number;
  awaitingApproval: number;
  approvedUnpaid: number;
  paid: number;
  /** The "N bills" under each figure — counted over every bill here, not in
   *  the component over whichever page of the table is showing. */
  counts: { raised: number; awaitingApproval: number; approvedUnpaid: number; paid: number };
};

/** The client Bills page's own stat row (ui-guide §6.11: "Bills Raised,
 *  Awaiting Approval, Approved Unpaid, Paid") — a different shape from the
 *  dashboard's mini stat (`getClientBillingStats`). */
export async function getClientBillsStats(projectId: string): Promise<ClientBillsStats> {
  const bills = await getBillsForClient(projectId);
  const sum = (pred: (b: BillDTO) => boolean) => bills.filter(pred).reduce((a, b) => a + b.netPayable, 0);
  const count = (pred: (b: BillDTO) => boolean) => bills.filter(pred).length;
  return {
    billsRaised: sum((b) => b.status !== "draft"),
    awaitingApproval: sum((b) => b.status === "submitted"),
    approvedUnpaid: sum((b) => b.status === "certified"),
    paid: sum((b) => b.status === "paid"),
    counts: {
      raised: count((b) => b.status !== "draft"),
      awaitingApproval: count((b) => b.status === "submitted"),
      approvedUnpaid: count((b) => b.status === "certified"),
      paid: count((b) => b.status === "paid"),
    },
  };
}

/**
 * Package Billing tab (ui-guide §6.5, admin only). "Phase billing status":
 * Phase, Tasks done, Bill Amount, Status, Mark Complete. `v_phase_billing`
 * predates this build (Build 05); this wires it to the tab and to which
 * bill (if any) each phase landed on.
 */
export type PhaseBillingRow = {
  id: string;
  name: string;
  taskCount: number;
  tasksDone: number;
  allocatedAmount: number;
  billingStatus: "unresolved" | "billable" | "billed" | "paid";
  /** Mirrors `rpc_mark_phase_complete`'s own guard exactly: zero tasks, not
   *  already manually completed, still in an open status. */
  canMarkComplete: boolean;
  billRefNo: string | null;
};

export async function getPhaseBillingStatus(packageId: string): Promise<PhaseBillingRow[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_phase_billing")
    .select("phase_id, name, allocated_amount, billing_status, task_count, tasks_done, is_complete")
    .eq("package_id", packageId);
  if (error) throw new Error(error.message);

  const rows = data.filter(
    (
      p
    ): p is typeof p & { phase_id: string; name: string; billing_status: PhaseBillingRow["billingStatus"] } =>
      p.phase_id != null && p.name != null && p.billing_status != null
  );

  const billRefByPhase = new Map<string, string>();
  if (rows.length > 0) {
    const { data: lineRows, error: lineErr } = await supabase
      .from("bill_lines")
      .select("source_id, bill_id")
      .eq("source_type", "phase")
      .in(
        "source_id",
        rows.map((p) => p.phase_id)
      );
    if (lineErr) throw new Error(lineErr.message);
    const billIds = [...new Set(lineRows.map((l) => l.bill_id))];
    if (billIds.length > 0) {
      const { data: bills, error: billErr } = await supabase
        .from("bills")
        .select("id, bill_no")
        .in("id", billIds);
      if (billErr) throw new Error(billErr.message);
      const billNoById = new Map(bills.map((b) => [b.id, b.bill_no]));
      for (const l of lineRows) {
        if (!l.source_id) continue;
        const billNo = billNoById.get(l.bill_id);
        if (billNo) billRefByPhase.set(l.source_id, billNo);
      }
    }
  }

  return rows.map((p) => ({
    id: p.phase_id,
    name: p.name,
    taskCount: p.task_count ?? 0,
    tasksDone: p.tasks_done ?? 0,
    allocatedAmount: Number(p.allocated_amount),
    billingStatus: p.billing_status,
    canMarkComplete:
      p.task_count === 0 &&
      !p.is_complete &&
      (p.billing_status === "unresolved" || p.billing_status === "billable"),
    billRefNo: billRefByPhase.get(p.phase_id) ?? null,
  }));
}

/** "Material at Site": delivered materials — Cost, Client Value, Billable
 *  (at `mas_billable_pct`), Status. Every delivered material for the
 *  package, billed or not — unlike `v_billable_now`, which only shows the
 *  still-unbilled ones. `fn_cost_to_client_factor` isn't exposed over
 *  PostgREST for a plain select, so its own phase-then-package fallback is
 *  replicated here in TypeScript from the same allocated/internal columns. */
export type MaterialAtSiteRow = {
  id: string;
  materialName: string;
  refNo: string;
  qty: number;
  unit: string;
  cost: number;
  clientValue: number;
  billableAmount: number;
  billRefNo: string | null;
  billStatus: BillDTO["status"] | null;
};

export async function getMaterialAtSite(packageId: string): Promise<MaterialAtSiteRow[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_requests")
    .select("id, ref_no, material_name, qty, unit, rate, phase_id, billed_on_bill_id")
    .eq("package_id", packageId)
    .eq("status", "delivered")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  if (data.length === 0) return [];

  const { data: pkg, error: pkgErr } = await supabase
    .from("packages")
    .select("allocated_amount, internal_amount, project_id")
    .eq("id", packageId)
    .single();
  if (pkgErr) throw new Error(pkgErr.message);
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("mas_billable_pct")
    .eq("id", pkg.project_id)
    .single();
  if (projErr) throw new Error(projErr.message);
  const masBillablePct = Number(project.mas_billable_pct);
  const packageInternal = Number(pkg.internal_amount);
  const packageFactor = packageInternal > 0 ? Number(pkg.allocated_amount) / packageInternal : 1;

  const phaseIds = [...new Set(data.map((r) => r.phase_id).filter((id): id is string => id != null))];
  const phaseFactorById = new Map<string, number>();
  if (phaseIds.length > 0) {
    const { data: phaseRows, error: phaseErr } = await supabase
      .from("phases")
      .select("id, allocated_amount, internal_amount")
      .in("id", phaseIds);
    if (phaseErr) throw new Error(phaseErr.message);
    for (const ph of phaseRows) {
      const internal = Number(ph.internal_amount);
      phaseFactorById.set(ph.id, internal > 0 ? Number(ph.allocated_amount) / internal : packageFactor);
    }
  }

  const billIds = [...new Set(data.map((r) => r.billed_on_bill_id).filter((id): id is string => id != null))];
  const billById = new Map<string, { billNo: string; status: BillDTO["status"] }>();
  if (billIds.length > 0) {
    const { data: bills, error: billErr } = await supabase
      .from("bills")
      .select("id, bill_no, status")
      .in("id", billIds);
    if (billErr) throw new Error(billErr.message);
    for (const b of bills) billById.set(b.id, { billNo: b.bill_no, status: b.status });
  }

  return data.map((r) => {
    const cost = Math.round(Number(r.qty) * Number(r.rate ?? 0) * 100) / 100;
    const factor = r.phase_id ? (phaseFactorById.get(r.phase_id) ?? packageFactor) : packageFactor;
    const clientValue = Math.round(cost * factor * 100) / 100;
    const bill = r.billed_on_bill_id ? billById.get(r.billed_on_bill_id) : undefined;
    return {
      id: r.id,
      materialName: r.material_name,
      refNo: r.ref_no,
      qty: Number(r.qty),
      unit: r.unit,
      cost,
      clientValue,
      billableAmount: Math.round(clientValue * masBillablePct) / 100,
      billRefNo: bill?.billNo ?? null,
      billStatus: bill?.status ?? null,
    };
  });
}
