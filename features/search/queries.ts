import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import { capResults, type SearchResultDTO } from "./service";

/**
 * build/07-stock-inventory-notifications.md §2.7. Each entity goes through
 * its OWN role-scoped query — the same views the rest of the app already
 * uses — so a client searching "marble" cannot learn a stock request or an
 * internal bill exists: the query for that category is never run for that
 * role, not merely filtered after the fact. Uses the EFFECTIVE role
 * (impersonating ?? real), matching every other read in this codebase
 * (Build 05: impersonation only ever shapes reads).
 */

function pattern(query: string): string {
  return `%${query}%`;
}

export async function searchAll(session: Session, query: string): Promise<SearchResultDTO[]> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";
  const isClient = effectiveRole === "client";
  const isSite = effectiveRole === "site";
  const supabase = await createClient();
  const q = pattern(query);

  const [projects, packages, stockRequests, approvals, bills, inventory, users] = await Promise.all([
    searchProjects(supabase, q),
    searchPackages(supabase, q, isAdmin, isClient),
    isClient ? Promise.resolve([]) : searchStockRequests(supabase, q, isAdmin),
    searchApprovals(supabase, q),
    isSite ? Promise.resolve([]) : searchBills(supabase, q, isAdmin),
    isClient ? Promise.resolve([]) : searchInventory(supabase, q, isAdmin),
    isAdmin ? searchUsers(supabase, q) : Promise.resolve([]),
  ]);

  return capResults({
    Projects: projects,
    Packages: packages,
    "Stock Requests": stockRequests,
    Approvals: approvals,
    Bills: bills,
    Inventory: inventory,
    Users: users,
  });
}

type Supa = Awaited<ReturnType<typeof createClient>>;

async function searchProjects(supabase: Supa, q: string): Promise<SearchResultDTO[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, location")
    .ilike("name", q)
    .limit(5);
  if (error) throw new Error(error.message);
  return data.map((p) => ({
    id: p.id,
    category: "Projects" as const,
    text: p.name,
    sub: p.location ?? "",
    href: `/projects/${p.id}`,
  }));
}

async function projectNames(supabase: Supa, projectIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("projects").select("id, name").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map(data.map((p) => [p.id, p.name]));
}

async function searchPackages(
  supabase: Supa,
  q: string,
  isAdmin: boolean,
  isClient: boolean
): Promise<SearchResultDTO[]> {
  type Row = { id: string; name: string; project_id: string };
  let rows: Row[];
  if (isAdmin) {
    const { data, error } = await supabase
      .from("packages")
      .select("id, name, project_id")
      .ilike("name", q)
      .limit(5);
    if (error) throw new Error(error.message);
    rows = data;
  } else if (isClient) {
    const { data, error } = await supabase
      .from("v_package_client")
      .select("id, name, project_id")
      .ilike("name", q)
      .limit(5);
    if (error) throw new Error(error.message);
    // The view's own column types come back nullable even though every one
    // of these is populated on every real row (same cast Build 05's
    // schedule queries make for v_package_site/v_phase_site).
    rows = data as Row[];
  } else {
    const { data, error } = await supabase
      .from("v_package_site")
      .select("id, name, project_id")
      .ilike("name", q)
      .limit(5);
    if (error) throw new Error(error.message);
    rows = data as Row[];
  }
  const names = await projectNames(
    supabase,
    rows.map((r) => r.project_id)
  );
  return rows.map((r) => ({
    id: r.id,
    category: "Packages" as const,
    text: r.name,
    sub: names.get(r.project_id) ?? "",
    href: `/projects/${r.project_id}/packages/${r.id}`,
  }));
}

async function searchStockRequests(supabase: Supa, q: string, isAdmin: boolean): Promise<SearchResultDTO[]> {
  type Row = { id: string; ref_no: string; material_name: string; project_id: string };
  const { data, error } = isAdmin
    ? await supabase
        .from("stock_requests")
        .select("id, ref_no, material_name, project_id")
        .ilike("material_name", q)
        .limit(5)
    : await supabase
        .from("v_stock_request_site")
        .select("id, ref_no, material_name, project_id")
        .ilike("material_name", q)
        .limit(5);
  if (error) throw new Error(error.message);
  const rows = data as Row[];
  const names = await projectNames(
    supabase,
    rows.map((r) => r.project_id)
  );
  return rows.map((r) => ({
    id: r.id,
    category: "Stock Requests" as const,
    text: r.material_name,
    sub: `${r.ref_no} · ${names.get(r.project_id) ?? ""}`,
    href: `/projects/${r.project_id}/stock`,
  }));
}

async function searchApprovals(supabase: Supa, q: string): Promise<SearchResultDTO[]> {
  const { data, error } = await supabase
    .from("approvals")
    .select("id, item, project_id")
    .ilike("item", q)
    .limit(5);
  if (error) throw new Error(error.message);
  const names = await projectNames(
    supabase,
    data.map((a) => a.project_id)
  );
  return data.map((a) => ({
    id: a.id,
    category: "Approvals" as const,
    text: a.item,
    sub: names.get(a.project_id) ?? "",
    href: `/projects/${a.project_id}/approvals`,
  }));
}

async function searchBills(supabase: Supa, q: string, isAdmin: boolean): Promise<SearchResultDTO[]> {
  type Row = { id: string; bill_no: string; project_id: string };
  const { data, error } = isAdmin
    ? await supabase.from("bills").select("id, bill_no, project_id").ilike("bill_no", q).limit(5)
    : await supabase.from("v_bill_client").select("id, bill_no, project_id").ilike("bill_no", q).limit(5);
  if (error) throw new Error(error.message);
  const rows = data as Row[];
  const names = await projectNames(
    supabase,
    rows.map((r) => r.project_id)
  );
  return rows.map((r) => ({
    id: r.id,
    category: "Bills" as const,
    text: r.bill_no,
    sub: names.get(r.project_id) ?? "",
    href: `/projects/${r.project_id}/billing`,
  }));
}

async function searchInventory(supabase: Supa, q: string, isAdmin: boolean): Promise<SearchResultDTO[]> {
  type Row = { id: string; name: string; project_id: string | null };
  const { data, error } = isAdmin
    ? await supabase.from("v_inventory_status").select("id, name, project_id").ilike("name", q).limit(5)
    : await supabase.from("v_inventory_site").select("id, name, project_id").ilike("name", q).limit(5);
  if (error) throw new Error(error.message);
  const rows = data as Row[];
  const names = await projectNames(
    supabase,
    rows.map((r) => r.project_id).filter((id): id is string => id != null)
  );
  return rows.map((r) => ({
    id: r.id,
    category: "Inventory" as const,
    text: r.name,
    sub: r.project_id ? (names.get(r.project_id) ?? "") : "Central store",
    href: r.project_id ? `/projects/${r.project_id}/inventory` : "/inventory",
  }));
}

async function searchUsers(supabase: Supa, q: string): Promise<SearchResultDTO[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .ilike("full_name", q)
    .limit(5);
  if (error) throw new Error(error.message);
  return data.map((u) => ({
    id: u.id,
    category: "Users" as const,
    text: u.full_name,
    sub: u.role,
    href: "/users",
  }));
}
