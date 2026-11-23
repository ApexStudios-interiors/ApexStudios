import "server-only";
import { Decimal } from "decimal.js";
import { createClient } from "@/lib/supabase/server";
import { requireSession, type Session } from "@/lib/auth/session";
import { presignGet } from "@/lib/r2/presign";
import { fetchPage, type Page, type PageRequest } from "@/lib/pagination";
import { billPdfFileName } from "./pdf";
import { billingTotals, isIssuedBill, sumAmounts, type BillStatus } from "./service";

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
  /** `v_billable_now.mas_recovery` — on a phase line, the material advance on
   *  committed bills that `rpc_create_bill` recovers at step D. The preview
   *  reads this same column, so it cannot disagree with the bill (APX-30).
   *  Always 0 on a material line. */
  masRecovery: number;
  /** A material's own phase; the phase's own id on a phase line. */
  phaseId: string | null;
  /** A draft bill holding one of this phase's materials (MAS rule R3): the
   *  phase cannot be billed until that draft is submitted or cancelled. */
  blockedByBillNo: string | null;
};

/** Admin only (`v_billable_now`'s own RLS-invoker policies already enforce
 *  this — a non-admin session simply sees the base tables it joins refuse
 *  it). Every figure, including each phase's MAS recovery, comes straight
 *  from the view `rpc_create_bill` reads — nothing is recomputed here. */
export async function getBillableNow(projectId: string): Promise<BillableNowLine[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_billable_now")
    .select(
      "source_type, source_id, description, client_value, pct_billed, amount, internal_cost, phase_id, mas_recovery, blocked_by_bill_no"
    )
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

  return rows.map((r) => ({
    sourceType: r.source_type,
    sourceId: r.source_id,
    description: r.description,
    clientValue: Number(r.client_value),
    pctBilled: Number(r.pct_billed),
    amount: Number(r.amount),
    internalCost: Number(r.internal_cost),
    masRecovery: Number(r.mas_recovery ?? 0),
    phaseId: r.phase_id,
    blockedByBillNo: r.blocked_by_bill_no,
  }));
}

/** Delivered, unbilled materials that Billable Now does NOT list, and why
 *  (APX-14, MAS rules R1/R4/R6 in migration 20261124200001). Shown as a note
 *  under Billable Now so a material never silently disappears. Admin only:
 *  `stock_requests` is an admin-only base table. */
export type UnlistedMaterials = {
  /** No rate, or a rate of 0 — billing it would be a ₹0 line (R6). */
  noRate: number;
  /** Package-level, not tied to a phase (R4, CA review). */
  noPhase: number;
  /** Its phase is already on a bill, which already covers it (R1). */
  coveredByPhaseBill: number;
};

export async function getUnlistedMaterials(projectId: string): Promise<UnlistedMaterials> {
  await requireSession();
  const supabase = await createClient();
  const [{ data: requests, error }, { data: listed, error: listedErr }] = await Promise.all([
    supabase
      .from("stock_requests")
      .select("id, rate, phase_id")
      .eq("project_id", projectId)
      .eq("status", "delivered")
      .is("billed_on_bill_id", null)
      .is("deleted_at", null),
    supabase
      .from("v_billable_now")
      .select("source_id")
      .eq("project_id", projectId)
      .eq("source_type", "material"),
  ]);
  if (error) throw new Error(error.message);
  if (listedErr) throw new Error(listedErr.message);
  const listedIds = new Set(listed.map((r) => r.source_id));

  const result: UnlistedMaterials = { noRate: 0, noPhase: 0, coveredByPhaseBill: 0 };
  for (const r of requests) {
    if (listedIds.has(r.id)) continue;
    if (r.rate == null || Number(r.rate) <= 0) result.noRate++;
    else if (!r.phase_id) result.noPhase++;
    else result.coveredByPhaseBill++;
  }
  return result;
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

/** The statuses a client's own lists and totals ever show: issued bills only
 *  (`isIssuedBill` in ./service.ts). */
const CLIENT_VISIBLE_BILL_STATUSES: BillStatus[] = ["submitted", "certified", "paid"];

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

/** Σ payments per bill, in Decimal — never a float running total. */
async function paidByBill(billIds: string[]): Promise<Map<string, Decimal>> {
  if (billIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("payments").select("bill_id, amount").in("bill_id", billIds);
  if (error) throw new Error(error.message);
  const map = new Map<string, Decimal>();
  for (const p of data) map.set(p.bill_id, (map.get(p.bill_id) ?? new Decimal(0)).plus(p.amount));
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

/**
 * Submitted bills per project, for the Sidebar's Bills badge (shown to a
 * client only) — the prototype counted them off `lib/data.ts`, so the badge
 * read 0 for every real project. Keyed by project because the app shell that
 * renders the Sidebar is a layout, and Next.js does not re-render a layout on
 * navigation: a figure scoped to "the project open right now" would be
 * whichever project the tab was first opened on and would never change.
 *
 * `v_bill_client` for the same reason every other client-facing bill read
 * uses it — `bills` itself is admin-only on select. One query projecting one
 * column over submitted rows only; `head: true` cannot be used because
 * PostgREST returns a single total, not a count per project.
 */
export async function countSubmittedBillsByProject(projectIds: string[]): Promise<Record<string, number>> {
  await requireSession();
  if (projectIds.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_bill_client")
    .select("project_id")
    .in("project_id", projectIds)
    .eq("status", "submitted");
  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  for (const row of data) {
    if (!row.project_id) continue;
    counts[row.project_id] = (counts[row.project_id] ?? 0) + 1;
  }
  return counts;
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

/** One page of the client Bills table. Only issued bills: a draft has never
 *  been sent, and a cancelled draft never was (APX-32) — the filter is in the
 *  query, where it has to be, so the page and the count agree with the rows. */
export async function getBillsPageForClient(projectId: string, req: PageRequest): Promise<Page<BillDTO>> {
  await requireSession();
  const supabase = await createClient();
  const page = await fetchPage(
    (from, to) =>
      supabase
        .from("v_bill_client")
        .select(CLIENT_BILL_COLUMNS, { count: "exact" })
        .eq("project_id", projectId)
        .in("status", CLIENT_VISIBLE_BILL_STATUSES)
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
  const isAdmin = effectiveRole === "admin";
  const supabase = await createClient();

  let bill: BillDTO | null = null;
  let lineRows: BillLineRow[] = [];

  if (isAdmin) {
    // A soft-deleted bill is gone for an admin too, as in every other admin
    // bill read (the Bills list, its page, the Excel export) — and as
    // `v_bill_client` already hides it from a client below.
    const { data: billRow, error } = await supabase
      .from("bills")
      .select(ADMIN_BILL_COLUMNS)
      .eq("id", billId)
      .is("deleted_at", null)
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

/**
 * The storage key of a bill's invoice PDF — the one the `bill.pdf` job
 * generated for the bill's CURRENT revision, or null when there is none yet.
 *
 * A bill's attachments mix two things with the same entity_type, entity id
 * and mime type: the generated invoice(s) and any copies uploaded as PDFs
 * (uploadBillCopy). What tells the invoice apart is the name the job gives it
 * — `billPdfFileName(bill_no, revision)` (./pdf.ts), the same name the job's
 * own "already generated?" check matches on. Matching it here means:
 *   - an uploaded scan (any other name) is never served as the invoice;
 *   - after a rejection and resubmission, the previous revision's document
 *     is not served while the new one is still being rendered — "not ready
 *     yet" instead of the stale PDF the client could certify against.
 * The newest row wins only between rows of that exact name.
 *
 * The bill itself is read as the role may see it — admin: `bills` without
 * soft-deleted rows; anyone else: `v_bill_client` — so a deleted bill, or
 * one the caller cannot see, has no PDF.
 */
export async function getCurrentBillPdfKey(session: Session, billId: string): Promise<string | null> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const supabase = await createClient();

  const { data: bill, error: billErr } =
    effectiveRole === "admin"
      ? await supabase
          .from("bills")
          .select("bill_no, revision")
          .eq("id", billId)
          .is("deleted_at", null)
          .maybeSingle()
      : await supabase.from("v_bill_client").select("bill_no, revision").eq("id", billId).maybeSingle();
  if (billErr) throw new Error(billErr.message);
  if (!bill?.bill_no || bill.revision == null) return null;

  const { data, error } = await supabase
    .from("attachments")
    .select("r2_key")
    .eq("entity_type", "bill")
    .eq("entity_id", billId)
    .eq("mime_type", "application/pdf")
    .eq("file_name", billPdfFileName(bill.bill_no, bill.revision))
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.r2_key ?? null;
}

export type AdminBillingStats = {
  billedToDate: number;
  /** How many bills that figure covers. Counted here, over every bill, not
   *  in the component over whichever page of the table is showing. */
  billedCount: number;
  received: number;
  /** Issued bills with at least one payment recorded. */
  paidCount: number;
  outstanding: number;
  billableNowCount: number;
  billableNowValue: number;
};

/** Admin's own stat row (ui-guide §6.11) — distinct from the dashboard's
 *  mini "Bills Raised" summary (`getClientBillingStats`, features/projects),
 *  which is the client's shape, not this one.
 *
 *  APX-32: "Billed to Date" counts issued bills only (submitted, certified,
 *  paid) — a cancelled draft was never sent and is not billed. "Received" is
 *  the sum of every payment recorded, part-payments included, not the net
 *  payable of fully-paid bills. Outstanding is `02-lld.md` §3.8's formula:
 *  Σ net_payable (certified, paid) − Σ payments on them. The arithmetic is
 *  `billingTotals` in ./service.ts, in Decimal. */
export async function getAdminBillingStats(projectId: string): Promise<AdminBillingStats> {
  await requireSession();
  const [bills, billable] = await Promise.all([getBillsForAdmin(projectId), getBillableNow(projectId)]);

  const issued = bills.filter((b) => isIssuedBill(b.status));
  const paid = await paidByBill(issued.map((b) => b.id));
  const totals = billingTotals(issued, paid);

  return {
    billedToDate: totals.billedToDate.toNumber(),
    billedCount: totals.billedCount,
    received: totals.received.toNumber(),
    paidCount: totals.paidCount,
    outstanding: totals.outstanding.toNumber(),
    billableNowCount: billable.length,
    billableNowValue: sumAmounts(billable).toNumber(),
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
  const paidSoFar = sumAmounts(data).toNumber();
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
  const bills = (await getBillsForClient(projectId)).filter((b) => isIssuedBill(b.status));
  const pick = (pred: (b: BillDTO) => boolean) => bills.filter(pred);
  const sum = (pred: (b: BillDTO) => boolean) =>
    sumAmounts(pick(pred).map((b) => ({ amount: b.netPayable }))).toNumber();
  const count = (pred: (b: BillDTO) => boolean) => pick(pred).length;
  const all = () => true;
  return {
    billsRaised: sum(all),
    awaitingApproval: sum((b) => b.status === "submitted"),
    approvedUnpaid: sum((b) => b.status === "certified"),
    paid: sum((b) => b.status === "paid"),
    counts: {
      raised: count(all),
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
  /** All tasks at 100%, or marked complete by hand (`v_phase_billing`). With
   *  an open billing status this is what makes a phase billable — the badge
   *  reads it through `phaseBillingLabel` (APX-49). */
  isComplete: boolean;
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
    isComplete: p.is_complete === true,
    canMarkComplete:
      p.task_count === 0 &&
      !p.is_complete &&
      (p.billing_status === "unresolved" || p.billing_status === "billable"),
    billRefNo: billRefByPhase.get(p.phase_id) ?? null,
  }));
}

/** "Material at Site": delivered materials — Cost, Client Value, Billable
 *  (at `mas_billable_pct`), Status. Every delivered material for the
 *  package, billed or not. The figures come from where they are decided: a
 *  billed material's from its own bill line, a billable one's from
 *  `v_billable_now` (the view `rpc_create_bill` bills from). Only a material
 *  that is neither shows a computed client value — `fn_cost_to_client_factor`
 *  replicated here in Decimal — and no billable amount, with the reason it is
 *  not billable as material at site (MAS rules R1/R4/R6, D68). */
export type MaterialAtSiteState =
  | "billed"
  | "billable"
  /** No rate, or a rate of 0 (R6). */
  | "no_rate"
  /** Package-level, not tied to a phase (R4). */
  | "no_phase"
  /** Its phase is already on a bill, which covers it (R1). */
  | "covered_by_phase";

export type MaterialAtSiteRow = {
  id: string;
  materialName: string;
  refNo: string;
  qty: number;
  unit: string;
  cost: number;
  clientValue: number;
  /** Null when the material is not billable as material at site. */
  billableAmount: number | null;
  state: MaterialAtSiteState;
  billRefNo: string | null;
  billStatus: BillDTO["status"] | null;
};

function factorOf(allocated: unknown, internal: unknown): Decimal | null {
  const i = new Decimal(Number(internal ?? 0));
  return i.greaterThan(0) ? new Decimal(Number(allocated ?? 0)).dividedBy(i) : null;
}

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
  const packageFactor = factorOf(pkg.allocated_amount, pkg.internal_amount) ?? new Decimal(1);

  const ids = data.map((r) => r.id);
  const phaseIds = [...new Set(data.map((r) => r.phase_id).filter((id): id is string => id != null))];
  const phaseFactorById = new Map<string, Decimal>();
  if (phaseIds.length > 0) {
    const { data: phaseRows, error: phaseErr } = await supabase
      .from("phases")
      .select("id, allocated_amount, internal_amount")
      .in("id", phaseIds);
    if (phaseErr) throw new Error(phaseErr.message);
    for (const ph of phaseRows) {
      phaseFactorById.set(ph.id, factorOf(ph.allocated_amount, ph.internal_amount) ?? packageFactor);
    }
  }

  const [{ data: listed, error: listedErr }, { data: billedLines, error: linesErr }] = await Promise.all([
    supabase
      .from("v_billable_now")
      .select("source_id, client_value, amount")
      .eq("source_type", "material")
      .in("source_id", ids),
    supabase
      .from("bill_lines")
      .select("source_id, client_value, amount")
      .eq("source_type", "material")
      .in("source_id", ids),
  ]);
  if (listedErr) throw new Error(listedErr.message);
  if (linesErr) throw new Error(linesErr.message);
  const listedById = new Map(listed.map((l) => [l.source_id, l]));
  const lineById = new Map(billedLines.map((l) => [l.source_id, l]));

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
    const rate = new Decimal(Number(r.rate ?? 0));
    const cost = new Decimal(Number(r.qty)).times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const factor = r.phase_id ? (phaseFactorById.get(r.phase_id) ?? packageFactor) : packageFactor;
    const computedClientValue = new Decimal(Number(r.qty))
      .times(rate)
      .times(factor)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const bill = r.billed_on_bill_id ? billById.get(r.billed_on_bill_id) : undefined;
    const line = lineById.get(r.id);
    const view = listedById.get(r.id);

    let state: MaterialAtSiteState;
    let clientValue = computedClientValue.toNumber();
    let billableAmount: number | null = null;
    if (bill || line) {
      state = "billed";
      if (line) {
        clientValue = Number(line.client_value);
        billableAmount = Number(line.amount);
      }
    } else if (view) {
      state = "billable";
      clientValue = Number(view.client_value);
      billableAmount = Number(view.amount);
    } else if (rate.lessThanOrEqualTo(0)) {
      state = "no_rate";
    } else if (!r.phase_id) {
      state = "no_phase";
    } else {
      state = "covered_by_phase";
    }

    return {
      id: r.id,
      materialName: r.material_name,
      refNo: r.ref_no,
      qty: Number(r.qty),
      unit: r.unit,
      cost: cost.toNumber(),
      clientValue,
      billableAmount,
      state,
      billRefNo: bill?.billNo ?? null,
      billStatus: bill?.status ?? null,
    };
  });
}
