import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import { fetchPage, type Page, type PageRequest, type RangeResult } from "@/lib/pagination";
import type { StockRequestStatus } from "./service";

/**
 * build/07-stock-inventory-notifications.md §2.2: "role-shaped. Admin sees
 * rate and value; site reads v_stock_request_site with no money columns;
 * client sees stock requests not at all." `stock_requests` itself is
 * admin-only on select (`sr_select_admin`) — a site session reading the base
 * table gets nothing, which is why `v_stock_request_site` (Build 02) exists
 * at all. Package names still need the same role branching Build 04/05/06
 * each rediscovered live: `packages` is an admin-only base table too.
 *
 * AGENTS.md database rule 7 (soft delete only): every read of a BASE table
 * here filters `deleted_at is null` explicitly. The site branches do not,
 * because `v_stock_request_site` and `v_package_site` (migration 0014) carry
 * that predicate in the view body. That asymmetry is exactly how the base
 * tables lost it unnoticed — the site surfaces looked correct while the admin
 * ones listed soft-deleted requests and counted them in the "N pending"
 * subtitle.
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
    const { data, error } = await supabase
      .from("packages")
      .select("id, name, seq_no")
      .eq("project_id", projectId)
      .is("deleted_at", null);
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
        (p): p is { id: string; name: string; seq_no: number } =>
          p.id != null && p.name != null && p.seq_no != null
      )
      .map((p) => [p.id, { name: p.name, seqNo: p.seq_no }])
  );
}

async function fetchProfileNames(profileIds: string[]): Promise<Map<string, string>> {
  if (profileIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", profileIds)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return new Map(data.map((p) => [p.id, p.full_name]));
}

type StockRequestFilter = { status?: StockRequestStatus; packageId?: string };

export async function getStockRequestsForProject(
  session: Session,
  projectId: string,
  opts: StockRequestFilter = {}
): Promise<StockRequestDTO[]> {
  return (await loadStockRequests(session, projectId, opts)).rows;
}

/**
 * The Stock Requests table: one page of the same role-shaped rows, filtered
 * and paginated in the query itself (`count: "exact"` + `.range()`,
 * lib/pagination.ts) — never fetched whole and sliced.
 */
export async function getStockRequestsPage(
  session: Session,
  projectId: string,
  opts: StockRequestFilter,
  req: PageRequest
): Promise<Page<StockRequestDTO>> {
  return loadStockRequests(session, projectId, opts, req);
}

/** How many requests match — the Stock page's "N pending" subtitle, which
 *  must not depend on which page of the table is showing. Same role split
 *  as the rows: `stock_requests` for admin, `v_stock_request_site` for site. */
export async function countStockRequests(
  session: Session,
  projectId: string,
  opts: StockRequestFilter
): Promise<number> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";
  if (effectiveRole === "client") return 0;

  const supabase = await createClient();
  if (isAdmin) {
    let query = supabase
      .from("stock_requests")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("deleted_at", null);
    if (opts.status) query = query.eq("status", opts.status);
    if (opts.packageId) query = query.eq("package_id", opts.packageId);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
  let query = supabase
    .from("v_stock_request_site")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (opts.status) query = query.eq("status", opts.status);
  if (opts.packageId) query = query.eq("package_id", opts.packageId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Pending requests per project, for the Sidebar's Stock Requests badge —
 * which the prototype counted off `lib/data.ts`, so it read 0 for every real
 * project. Keyed by project because the app shell that renders the Sidebar is
 * a layout: Next.js does not re-render a layout on navigation, so a figure
 * scoped to "the project open right now" would be whichever project the tab
 * was first opened on and would never change again.
 *
 * Same role split as the rows (`stock_requests` for admin, the money-free
 * `v_stock_request_site` for site); a client has no Stock route at all
 * (01-hld.md §7.1) and no badge, so it never runs. One query projecting one
 * column over pending rows only — `head: true` cannot be used because
 * PostgREST returns a single total, not a count per project.
 */
export async function countPendingRequestsByProject(
  session: Session,
  projectIds: string[]
): Promise<Record<string, number>> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  if (effectiveRole === "client" || projectIds.length === 0) return {};
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";

  const supabase = await createClient();
  const { data, error } = isAdmin
    ? await supabase
        .from("stock_requests")
        .select("project_id")
        .in("project_id", projectIds)
        .eq("status", "pending")
        .is("deleted_at", null)
    : await supabase
        .from("v_stock_request_site")
        .select("project_id")
        .in("project_id", projectIds)
        .eq("status", "pending");
  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  for (const row of data) {
    if (!row.project_id) continue;
    counts[row.project_id] = (counts[row.project_id] ?? 0) + 1;
  }
  return counts;
}

/** Without `req`, every matching row (the project dashboard's own list);
 *  with it, one page of them. */
async function loadStockRequests(
  session: Session,
  projectId: string,
  opts: StockRequestFilter,
  req?: PageRequest
): Promise<Page<StockRequestDTO>> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";
  // 01-hld.md §7.1: no route at all
  if (effectiveRole === "client") return { rows: [], total: 0, page: 1, pageSize: req?.pageSize ?? 0 };

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

  // Every matching row, or — with `req` — one page of them.
  //
  // Ordered by `needed_by` ascending, so the most urgent request is first —
  // applied in the QUERY, not to a fetched page, or page 2 would be sorted
  // against page 1's contents. Rows with NO needed-by date sort LAST
  // (`nullsFirst: false`): a request with no deadline carries no urgency
  // signal at all, and Postgres's own default for an ascending order would
  // otherwise put those nulls at the very top, above the genuinely overdue
  // ones. `created_at` then `id` break ties, exactly as before, so paging
  // stays stable within one needed-by date.
  const all = async <T>(query: PromiseLike<RangeResult<T>>): Promise<Page<T>> => {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    return { rows, total: rows.length, page: 1, pageSize: rows.length };
  };

  let result: Page<Row>;
  if (isAdmin) {
    const query = () => {
      let q = supabase
        .from("stock_requests")
        .select(
          "id, ref_no, project_id, package_id, material_name, qty, unit, rate, needed_by, note, status, requested_by, created_at, approved_at, ordered_at, delivered_at, rejected_reason",
          { count: req ? "exact" : undefined }
        )
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("needed_by", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (opts.status) q = q.eq("status", opts.status);
      if (opts.packageId) q = q.eq("package_id", opts.packageId);
      return q;
    };
    result = req ? await fetchPage((from, to) => query().range(from, to), req) : await all(query());
  } else {
    const query = () => {
      let q = supabase
        .from("v_stock_request_site")
        .select(
          "id, ref_no, project_id, package_id, material_name, qty, unit, needed_by, note, status, requested_by, created_at, approved_at, ordered_at, delivered_at, rejected_reason",
          { count: req ? "exact" : undefined }
        )
        .eq("project_id", projectId)
        .order("needed_by", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (opts.status) q = q.eq("status", opts.status);
      if (opts.packageId) q = q.eq("package_id", opts.packageId);
      return q;
    };
    const page = req ? await fetchPage((from, to) => query().range(from, to), req) : await all(query());
    // The view's own column types come back nullable (a view generally can't
    // promise NOT NULL the way its base table does) even though every one of
    // these is populated on every real row — same cast Build 05's own
    // schedule queries make for v_package_site/v_phase_site.
    result = { ...page, rows: page.rows as Row[] };
  }
  const rows = result.rows;

  const packageNames = await fetchPackageNames(isAdmin, projectId);
  const requesterNames = await fetchProfileNames([...new Set(rows.map((r) => r.requested_by))]);

  const dtos = rows.map((r) => {
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
  return { ...result, rows: dtos };
}
