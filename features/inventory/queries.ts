import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import { inventoryStatus, type InventoryStatus } from "./service";

/**
 * build/07-stock-inventory-notifications.md §2.3. `unit_cost` is admin-only
 * (D30, docs/decisions.md — AGENTS.md names this column explicitly, and
 * wins over the build file's own looser wording). `v_inventory_status`
 * (admin) carries it; `v_inventory_site` (site) never does. The stat row's
 * aggregation happens in `rpc_inventory_stats` (SQL, not a paginated
 * TypeScript sum) — this file's own job is discarding `total_value` for
 * anyone who isn't admin, since the RPC itself computes it unconditionally.
 */

export type InventoryItemDTO = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  name: string;
  category: string | null;
  sku: string | null;
  unit: string;
  qtyOnHand: number;
  reorderLevel: number;
  unitCost: number | null;
  stockValue: number | null;
  location: string | null;
  status: InventoryStatus;
};

export type InventoryStats = {
  totalItems: number;
  totalValue: number | null;
  lowCount: number;
  criticalCount: number;
};

const EMPTY_STATS: InventoryStats = { totalItems: 0, totalValue: null, lowCount: 0, criticalCount: 0 };

type StatusRow = {
  id: string;
  project_id: string | null;
  name: string;
  category: string | null;
  sku: string | null;
  unit: string;
  qty_on_hand: number;
  reorder_level: number;
  location: string | null;
  unit_cost?: number;
  stock_value?: number;
};

async function fetchRows(
  isAdmin: boolean,
  filter: { projectId?: string }
): Promise<StatusRow[]> {
  const supabase = await createClient();
  if (isAdmin) {
    let query = supabase
      .from("v_inventory_status")
      .select("id, project_id, name, category, sku, unit, qty_on_hand, reorder_level, unit_cost, stock_value, location")
      .order("name");
    if (filter.projectId) query = query.eq("project_id", filter.projectId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data as StatusRow[];
  }
  let query = supabase
    .from("v_inventory_site")
    .select("id, project_id, name, category, sku, unit, qty_on_hand, reorder_level, location")
    .order("name");
  if (filter.projectId) query = query.eq("project_id", filter.projectId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  // The view's own column types come back nullable even though every one of
  // these is populated on every real row (same cast Build 05's schedule
  // queries make for v_package_site/v_phase_site).
  return data as StatusRow[];
}

async function fetchProjectNames(projectIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("id, name").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map(data.map((p) => [p.id, p.name]));
}

function toDTO(r: StatusRow, isAdmin: boolean, projectNames: Map<string, string>): InventoryItemDTO {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_id ? (projectNames.get(r.project_id) ?? null) : null,
    name: r.name,
    category: r.category,
    sku: r.sku,
    unit: r.unit,
    qtyOnHand: r.qty_on_hand,
    reorderLevel: r.reorder_level,
    unitCost: isAdmin ? (r.unit_cost ?? null) : null,
    stockValue: isAdmin ? (r.stock_value ?? null) : null,
    location: r.location,
    status: inventoryStatus(r.qty_on_hand, r.reorder_level),
  };
}

async function fetchStats(isAdmin: boolean, projectId?: string): Promise<InventoryStats> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_inventory_stats", { p_project_id: projectId });
  if (error) throw new Error(error.message);
  const row = data[0];
  return {
    totalItems: Number(row?.total_items ?? 0),
    // Discarded for non-admin here — the RPC computes it unconditionally
    // (its own comment says so); this is the actual boundary.
    totalValue: isAdmin ? Number(row?.total_value ?? 0) : null,
    lowCount: Number(row?.low_count ?? 0),
    criticalCount: Number(row?.critical_count ?? 0),
  };
}

export async function getProjectInventory(
  session: Session,
  projectId: string
): Promise<{ items: InventoryItemDTO[]; stats: InventoryStats }> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";
  if (effectiveRole === "client") return { items: [], stats: EMPTY_STATS };

  const rows = await fetchRows(isAdmin, { projectId });
  const items = rows.map((r) => toDTO(r, isAdmin, new Map()));
  const stats = await fetchStats(isAdmin, projectId);
  return { items, stats };
}

export async function getBusinessInventory(
  session: Session,
  opts: { projectId?: string } = {}
): Promise<{ items: InventoryItemDTO[]; stats: InventoryStats }> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";
  if (effectiveRole === "client") return { items: [], stats: EMPTY_STATS };

  const rows = await fetchRows(isAdmin, opts);
  const projectNames = await fetchProjectNames(rows.map((r) => r.project_id).filter((id): id is string => id != null));
  const items = rows.map((r) => toDTO(r, isAdmin, projectNames));
  const stats = await fetchStats(isAdmin, opts.projectId);
  return { items, stats };
}
