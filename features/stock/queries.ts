import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import type { StockRequestStatus } from "./service";

/**
 * build/07-stock-inventory-notifications.md §2.2: "role-shaped. Admin sees
 * rate and value; site reads v_stock_request_site with no money columns;
 * client sees stock requests not at all." `stock_requests` itself is
 * admin-only on select (`sr_select_admin`) — a site session reading the base
 * table gets nothing, which is why `v_stock_request_site` (Build 02) exists
 * at all. Package names still need the same role branching Build 04/05/06
 * each rediscovered live: `packages` is an admin-only base table too.
 */

export type StockRequestDTO = {
  id: string;
  refNo: string;
  projectId: string;
  packageId: string;
  packageName: string | null;
  materialName: string;
  qty: number;
  unit: string;
  rate: number | null;
  value: number | null;
  neededBy: string | null;
  note: string | null;
  status: StockRequestStatus;
  requestedByName: string;
  createdAt: string;
  approvedAt: string | null;
  orderedAt: string | null;
  deliveredAt: string | null;
  rejectedReason: string | null;
};

type PackageInfo = { name: string; seqNo: number };

async function fetchPackageNames(isAdmin: boolean, projectId: string): Promise<Map<string, PackageInfo>> {
  const supabase = await createClient();
  if (isAdmin) {
    const { data, error } = await supabase.from("packages").select("id, name, seq_no").eq("project_id", projectId);
    if (error) throw new Error(error.message);
    return new Map(data.map((p) => [p.id, { name: p.name, seqNo: p.seq_no }]));
  }
  const { data, error } = await supabase
    .from("v_package_site")
    .select("id, name, seq_no")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  return new Map(
    data
      .filter(
        (p): p is { id: string; name: string; seq_no: number } => p.id != null && p.name != null && p.seq_no != null
      )
      .map((p) => [p.id, { name: p.name, seqNo: p.seq_no }])
  );
}

async function fetchProfileNames(profileIds: string[]): Promise<Map<string, string>> {
  if (profileIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", profileIds);
  if (error) throw new Error(error.message);
  return new Map(data.map((p) => [p.id, p.full_name]));
}

export async function getStockRequestsForProject(
  session: Session,
  projectId: string,
  opts: { status?: StockRequestStatus; packageId?: string } = {}
): Promise<StockRequestDTO[]> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";
  if (effectiveRole === "client") return []; // 01-hld.md §7.1: no route at all

  const supabase = await createClient();

  type Row = {
    id: string;
    ref_no: string;
    project_id: string;
    package_id: string;
    material_name: string;
    qty: number;
    unit: string;
    rate?: number | null;
    needed_by: string | null;
    note: string | null;
    status: StockRequestStatus;
    requested_by: string;
    created_at: string;
    approved_at: string | null;
    ordered_at: string | null;
    delivered_at: string | null;
    rejected_reason: string | null;
  };

  let rows: Row[];
  if (isAdmin) {
    let query = supabase
      .from("stock_requests")
      .select(
        "id, ref_no, project_id, package_id, material_name, qty, unit, rate, needed_by, note, status, requested_by, created_at, approved_at, ordered_at, delivered_at, rejected_reason"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (opts.status) query = query.eq("status", opts.status);
    if (opts.packageId) query = query.eq("package_id", opts.packageId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows = data;
  } else {
    let query = supabase
      .from("v_stock_request_site")
      .select(
        "id, ref_no, project_id, package_id, material_name, qty, unit, needed_by, note, status, requested_by, created_at, approved_at, ordered_at, delivered_at, rejected_reason"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (opts.status) query = query.eq("status", opts.status);
    if (opts.packageId) query = query.eq("package_id", opts.packageId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    // The view's own column types come back nullable (a view generally can't
    // promise NOT NULL the way its base table does) even though every one of
    // these is populated on every real row — same cast Build 05's own
    // schedule queries make for v_package_site/v_phase_site.
    rows = data as Row[];
  }

  const packageNames = await fetchPackageNames(isAdmin, projectId);
  const requesterNames = await fetchProfileNames([...new Set(rows.map((r) => r.requested_by))]);

  return rows.map((r) => {
    const rate = isAdmin ? (r.rate ?? null) : null;
    return {
      id: r.id,
      refNo: r.ref_no,
      projectId: r.project_id,
      packageId: r.package_id,
      packageName: packageNames.get(r.package_id)?.name ?? null,
      materialName: r.material_name,
      qty: r.qty,
      unit: r.unit,
      rate,
      value: rate != null ? Math.round(r.qty * rate * 100) / 100 : null,
      neededBy: r.needed_by,
      note: r.note,
      status: r.status,
      requestedByName: requesterNames.get(r.requested_by) ?? "—",
      createdAt: r.created_at,
      approvedAt: r.approved_at,
      orderedAt: r.ordered_at,
      deliveredAt: r.delivered_at,
      rejectedReason: r.rejected_reason,
    };
  });
}
