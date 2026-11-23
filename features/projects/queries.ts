import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import { parseRateVisibility, projectStatusLabel, type RateVisibility } from "./service";
import { isIssuedBill, sumAmounts, type BillStatus } from "@/features/billing/service";

/**
 * Three separate functions, not one with a role ternary on the select list
 * (build/04-projects-packages-phases.md §4.1). Each reads only what that role
 * may see; the non-admin ones never touch `packages` at all.
 */

export type ProjectCardDTO = {
  id: string;
  /** The project code, e.g. `BHEL-NCH`. Carried so a link can be built as the
   *  canonical `/projects/bhel-nch` rather than `/projects/<uuid>`, which
   *  middleware would have to redirect (lib/routing/paths.ts). */
  code: string;
  name: string;
  client: string;
  location: string | null;
  status: string;
  progressPct: number;
  start: string | null;
  packageCount: number;
  /** Allocated for admin/client, null for site — matches the prototype's
   *  ProjectCard, which never shows a money figure to site at all. */
  headlineAmount: string | null;
  /** Present for admin only. null means "not this role", not "zero". */
  budgetUsedPct: number | null;
};

export type PortfolioAdmin = {
  role: "money";
  stats: { totalAllocated: string; totalInternal: string; committed: string; activeProjects: number };
  projects: ProjectCardDTO[];
};
export type PortfolioClient = {
  role: "client";
  stats: { totalContractValue: string; activeProjects: number; awaitingApproval: number };
  projects: ProjectCardDTO[];
};
export type PortfolioSite = {
  role: "site";
  stats: { activeProjects: number; packagesInProgress: number; pendingRequests: number };
  projects: ProjectCardDTO[];
};

/** `effectiveRole` decides which table/view backs the package count — see
 *  getPortfolio's own doc comment for why this must be the effective role,
 *  not session.role directly, under impersonation. */
async function fetchProjectRows(effectiveRole: "admin" | "site" | "client") {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    // No contract_value: authenticated has no SELECT on it (APX-09) — site
    // must never see it. The client portfolio reads it from v_project_finance.
    .select("id, code, name, location, status, progress_pct, start_date, client_id")
    .is("deleted_at", null)
    // start_date, not created_at: every row in supabase/seed.sql's multi-row
    // INSERT gets the identical now() (Postgres evaluates it once per
    // statement), so created_at ties across the whole seed and the tiebreak
    // Postgres happens to pick is whatever the query plan finds first — not
    // insertion order. Found live: the portfolio rendered BHEL Nagnar
    // Entrance Arch before BHEL Nagnar Club House, though the seed inserts
    // Club House first. start_date is a real, distinct value per project and
    // is also the more sensible portfolio order (oldest project first).
    .order("start_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);

  // .from() needs a literal table name — its overloads pick the return type
  // from the string literal, so a variable collapses every branch's typing.
  const projectIds = data.map((p) => p.id);
  const isAdmin = effectiveRole === "admin";

  const clientIds = [...new Set(data.map((p) => p.client_id))];
  // `clients` itself is is_admin()-only (0003's own comment: "a client user
  // does not read the clients table") — contact_person, email, phone, gstin
  // and billing_address are genuinely admin-only. v_client_name is the
  // column-isolated view for everyone else; see its migration for why it did
  // not already exist. Getting this branch wrong renders an empty client name
  // for every site and client session, silently — it will not throw.
  //
  // The two reads below go OUT TOGETHER. Each needs only the ids from the
  // query above and neither reads the other's result, so awaiting them in
  // sequence cost a round trip for nothing — on every page, since the app
  // shell calls this on each render.
  const [clientsRes, pkgCountsRes] = await Promise.all([
    isAdmin
      ? supabase.from("clients").select("id, name").in("id", clientIds)
      : supabase.from("v_client_name").select("id, name").in("id", clientIds),
    isAdmin
      ? supabase.from("packages").select("id, project_id").in("project_id", projectIds)
      : supabase.from("v_package_site").select("id, project_id").in("project_id", projectIds),
  ]);
  const { data: clients, error: clientErr } = clientsRes;
  if (clientErr) throw new Error(clientErr.message);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const { data: pkgCounts, error: pkgErr } = pkgCountsRes;
  if (pkgErr) throw new Error(pkgErr.message);
  const packageCountByProject = new Map<string, number>();
  for (const row of pkgCounts) {
    if (!row.project_id) continue;
    packageCountByProject.set(row.project_id, (packageCountByProject.get(row.project_id) ?? 0) + 1);
  }

  return { projects: data, clientName, packageCountByProject };
}

export async function getPortfolioForAdmin(): Promise<PortfolioAdmin> {
  const supabase = await createClient();
  const { projects, clientName, packageCountByProject } = await fetchProjectRows("admin");

  const { data: rollups, error } = await supabase
    .from("v_package_rollup")
    .select("project_id, allocated_amount, internal_amount, committed")
    .in(
      "project_id",
      projects.map((p) => p.id)
    );
  if (error) throw new Error(error.message);

  const byProject = new Map<string, { alloc: number; int: number; committed: number }>();
  for (const r of rollups) {
    // View columns are always reported nullable by Postgres's catalog,
    // regardless of the underlying table's own NOT NULL constraints — a
    // real Postgres/information_schema characteristic, not a generator gap.
    if (!r.project_id) continue;
    const cur = byProject.get(r.project_id) ?? { alloc: 0, int: 0, committed: 0 };
    cur.alloc += Number(r.allocated_amount ?? 0);
    cur.int += Number(r.internal_amount ?? 0);
    cur.committed += Number(r.committed ?? 0);
    byProject.set(r.project_id, cur);
  }

  let totalAllocated = 0,
    totalInternal = 0,
    totalCommitted = 0;
  const projectCards: ProjectCardDTO[] = projects.map((p) => {
    const agg = byProject.get(p.id) ?? { alloc: 0, int: 0, committed: 0 };
    totalAllocated += agg.alloc;
    totalInternal += agg.int;
    totalCommitted += agg.committed;
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      client: clientName.get(p.client_id) ?? "",
      location: p.location,
      status: projectStatusLabel(p.status),
      progressPct: p.progress_pct,
      start: p.start_date,
      packageCount: packageCountByProject.get(p.id) ?? 0,
      headlineAmount: String(agg.alloc),
      budgetUsedPct: agg.int > 0 ? Math.round((agg.committed / agg.int) * 100) : 0,
    };
  });

  return {
    role: "money",
    stats: {
      totalAllocated: String(totalAllocated),
      totalInternal: String(totalInternal),
      committed: String(totalCommitted),
      activeProjects: projects.filter((p) => p.status === "active").length,
    },
    projects: projectCards,
  };
}

export async function getPortfolioForClient(): Promise<PortfolioClient> {
  const supabase = await createClient();
  const { projects, clientName, packageCountByProject } = await fetchProjectRows("client");

  const projectIds = projects.map((p) => p.id);
  // ui-guide.md §6.1: "Awaiting Your Approval" is samples AND bills — the
  // prototype's apPendAll + billsPendAll. approvals is is_member_of-gated
  // (a client decides their own project's approvals directly, §6.10), but
  // bills is admin-only on select — v_bill_client is the client-safe read.
  const { count: pendingApprovals, error } = await supabase
    .from("approvals")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .in("project_id", projectIds);
  if (error) throw new Error(error.message);

  const { count: pendingBills, error: billErr } = await supabase
    .from("v_bill_client")
    .select("id", { count: "exact", head: true })
    .eq("status", "submitted")
    .in("project_id", projectIds);
  if (billErr) throw new Error(billErr.message);

  const awaitingApproval = (pendingApprovals ?? 0) + (pendingBills ?? 0);

  // contract_value lives behind v_project_finance (admin or client only,
  // APX-09), not on projects, so a site session has no path to it at all.
  const { data: finance, error: financeErr } = await supabase
    .from("v_project_finance")
    .select("id, contract_value")
    .in("id", projectIds);
  if (financeErr) throw new Error(financeErr.message);
  const contractValue = new Map(finance.map((f) => [f.id, Number(f.contract_value ?? 0)]));

  const projectCards: ProjectCardDTO[] = projects.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    client: clientName.get(p.client_id) ?? "",
    location: p.location,
    status: projectStatusLabel(p.status),
    progressPct: p.progress_pct,
    start: p.start_date,
    packageCount: packageCountByProject.get(p.id) ?? 0,
    headlineAmount: String(contractValue.get(p.id) ?? 0),
    budgetUsedPct: null,
  }));

  return {
    role: "client",
    stats: {
      totalContractValue: String(projects.reduce((a, p) => a + (contractValue.get(p.id) ?? 0), 0)),
      activeProjects: projects.filter((p) => p.status === "active").length,
      awaitingApproval,
    },
    projects: projectCards,
  };
}

export async function getPortfolioForSite(): Promise<PortfolioSite> {
  const supabase = await createClient();
  const { projects, clientName, packageCountByProject } = await fetchProjectRows("site");
  const projectIds = projects.map((p) => p.id);

  const { data: sitePkgs, error: pkgErr } = await supabase
    .from("v_package_site")
    .select("project_id, status")
    .in("project_id", projectIds);
  if (pkgErr) throw new Error(pkgErr.message);

  const { count: pendingRequests, error: reqErr } = await supabase
    .from("v_stock_request_site")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .in("project_id", projectIds);
  if (reqErr) throw new Error(reqErr.message);

  const projectCards: ProjectCardDTO[] = projects.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    client: clientName.get(p.client_id) ?? "",
    location: p.location,
    status: projectStatusLabel(p.status),
    progressPct: p.progress_pct,
    start: p.start_date,
    packageCount: packageCountByProject.get(p.id) ?? 0,
    headlineAmount: null,
    budgetUsedPct: null,
  }));

  return {
    role: "site",
    stats: {
      activeProjects: projects.filter((p) => p.status === "active").length,
      packagesInProgress: sitePkgs.filter((r) => r.status === "in_progress").length,
      pendingRequests: pendingRequests ?? 0,
    },
    projects: projectCards,
  };
}

export type Portfolio = PortfolioAdmin | PortfolioClient | PortfolioSite;

/**
 * Dispatches on the EFFECTIVE role (session.impersonating?.role ?? session.role),
 * not the real one directly. RLS itself does not change under impersonation —
 * an admin previewing "client" still passes is_admin() at the database layer,
 * since the JWT is unaffected. The preview only works because the APPLICATION
 * chooses to run the client-shaped query instead of the admin one; getting this
 * dispatch wrong would defeat D20's entire point.
 */
export async function getPortfolio(session: Session): Promise<Portfolio> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  if (effectiveRole === "admin") return getPortfolioForAdmin();
  if (effectiveRole === "client") return getPortfolioForClient();
  return getPortfolioForSite();
}

// ── Project Dashboard (§6.2) ─────────────────────────────────────────────────
// The header (name, client, location, start, status, progress) is the same
// for every role — projects_select has no admin gate, only is_member_of — so
// this is one function, not three. The stat row's remaining numbers come from
// getPackagesForProject's own totals (already computed there; not redone
// here) plus the two small role-specific reads below.

export type ProjectHeaderDTO = {
  id: string;
  name: string;
  client: string;
  location: string | null;
  start: string | null;
  status: string;
  progressPct: number;
  /** D55 — per-project Rate visibility for Site Supervisors. Not money: it is
   *  the policy about who may type a rate, and every role may read it. */
  rateVisibility: RateVisibility;
};

export async function getProjectHeader(
  session: Session,
  projectId: string
): Promise<ProjectHeaderDTO | null> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "admin";
  const supabase = await createClient();
  const { data: p, error } = await supabase
    .from("projects")
    .select("id, name, location, status, progress_pct, start_date, client_id, rate_visibility")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) return null;

  const { data: c, error: clientErr } = isAdmin
    ? await supabase.from("clients").select("name").eq("id", p.client_id).maybeSingle()
    : await supabase.from("v_client_name").select("name").eq("id", p.client_id).maybeSingle();
  if (clientErr) throw new Error(clientErr.message);

  return {
    id: p.id,
    name: p.name,
    client: c?.name ?? "",
    location: p.location,
    start: p.start_date,
    status: projectStatusLabel(p.status),
    progressPct: p.progress_pct,
    rateVisibility: parseRateVisibility(p.rate_visibility),
  };
}

/** Client dashboard's "Bills Raised" / "Awaiting Your Approval" extra stats
 *  (ui-guide §6.2). `bills` is admin-only on select — v_bill_client is the
 *  client-safe read, already carrying net_payable pre-computed by the row
 *  itself (02-lld.md §3.8), not recomputed here. */
export type ClientBillingStats = {
  billedNet: number;
  paidNet: number;
  billsSubmitted: number;
  approvalsPending: number;
};

export async function getClientBillingStats(projectId: string): Promise<ClientBillingStats> {
  const supabase = await createClient();
  const { data: bills, error } = await supabase
    .from("v_bill_client")
    .select("status, net_payable")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  // Issued bills only (APX-32): a cancelled draft was never sent. Summed in
  // Decimal, never a float running total.
  const netOf = (pred: (status: BillStatus) => boolean) =>
    sumAmounts(
      bills
        .filter((b) => b.status != null && pred(b.status))
        .map((b) => ({ amount: Number(b.net_payable ?? 0) }))
    ).toNumber();
  const billedNet = netOf(isIssuedBill);
  const paidNet = netOf((s) => s === "paid");
  const billsSubmitted = bills.filter((b) => b.status === "submitted").length;

  const { count: approvalsPending, error: apErr } = await supabase
    .from("approvals")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "pending");
  if (apErr) throw new Error(apErr.message);

  return { billedNet, paidNet, billsSubmitted, approvalsPending: approvalsPending ?? 0 };
}

/** Site dashboard's "Pending Requests" / "To Receive" extra stats (ui-guide
 *  §6.2). "Packages in Progress" comes from getPackagesForProject's own rows
 *  instead — not re-queried here. */
export type SiteStockStats = { pendingRequests: number; toReceive: number };

export async function getSiteStockStats(projectId: string): Promise<SiteStockStats> {
  const supabase = await createClient();
  const { count: pendingRequests, error } = await supabase
    .from("v_stock_request_site")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);

  const { count: toReceive, error: err2 } = await supabase
    .from("v_stock_request_site")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "ordered");
  if (err2) throw new Error(err2.message);

  return { pendingRequests: pendingRequests ?? 0, toReceive: toReceive ?? 0 };
}

/** One client login, as the project dashboard's Client access card lists it. */
export type ClientLoginDTO = { id: string; fullName: string; email: string | null };

/** A client login on this project, with how many live projects it can see in
 *  all — the card disables Remove when this is its only one (D51). */
export type ClientMemberDTO = ClientLoginDTO & { projectCount: number };

export type ProjectClientAccess = {
  /** Client logins that can see this project. */
  members: ClientMemberDTO[];
  /** Client logins in the org that cannot see it yet — "Add existing client". */
  others: ClientLoginDTO[];
};

/**
 * D51: client logins are created and granted per project. Owner/admin only —
 * the page calls this for those roles alone, and both reads are RLS-scoped
 * (`profiles_select` to the org, `pm_select` via is_member_of, which is true
 * for every project for an admin). profiles carries no money columns.
 */
export async function getProjectClientAccess(projectId: string): Promise<ProjectClientAccess> {
  const supabase = await createClient();
  const [clients, members] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "client")
      .is("deleted_at", null)
      .order("full_name", { ascending: true }),
    supabase.from("project_members").select("profile_id").eq("project_id", projectId),
  ]);
  if (clients.error) throw new Error(clients.error.message);
  if (members.error) throw new Error(members.error.message);

  const memberIds = new Set(members.data.map((m) => m.profile_id));
  const projectsByClient = await clientProjectMap([...memberIds]);
  const result: ProjectClientAccess = { members: [], others: [] };
  for (const p of clients.data) {
    const dto = { id: p.id, fullName: p.full_name, email: p.email };
    if (memberIds.has(p.id)) {
      result.members.push({ ...dto, projectCount: projectsByClient.get(p.id)?.length ?? 0 });
    } else {
      result.others.push(dto);
    }
  }
  return result;
}

/** A project a client login can see, as the Users page lists it. */
export type ClientProjectDTO = { id: string; code: string; name: string };

/**
 * The live projects each of `profileIds` is a member of, by profile id. Owner/
 * admin callers only (the Client access card and the Users page): pm_select
 * lets an admin read every membership row in the org, and projects_select is
 * org-scoped. id, code and name only — no money column.
 */
async function clientProjectMap(profileIds: string[]): Promise<Map<string, ClientProjectDTO[]>> {
  const byProfile = new Map<string, ClientProjectDTO[]>();
  if (profileIds.length === 0) return byProfile;

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("project_members")
    .select("profile_id, project_id")
    .in("profile_id", profileIds);
  if (error) throw new Error(error.message);
  if (rows.length === 0) return byProfile;

  const { data: projects, error: pErr } = await supabase
    .from("projects")
    .select("id, code, name")
    .in("id", [...new Set(rows.map((r) => r.project_id))])
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (pErr) throw new Error(pErr.message);

  const projectById = new Map(projects.map((p) => [p.id, p]));
  for (const r of rows) {
    const p = projectById.get(r.project_id);
    if (!p) continue; // soft-deleted project
    const list = byProfile.get(r.profile_id) ?? [];
    list.push({ id: p.id, code: p.code, name: p.name });
    byProfile.set(r.profile_id, list);
  }
  for (const list of byProfile.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return byProfile;
}

/** For the Users page: each listed client login's projects (D51). */
export async function listClientProjects(clientIds: string[]): Promise<Record<string, ClientProjectDTO[]>> {
  return Object.fromEntries(await clientProjectMap(clientIds));
}

/** A project as a form's Project select lists it. */
export type ProjectOptionDTO = { id: string; name: string };

/**
 * The org's non-archived projects, for the Project select in Add User's Client role
 * (D51 amendment, 2026-11-23). Owner/admin only — the Users page is guarded to
 * those roles — and RLS-scoped as every projects read is. id and name only:
 * no money column is selected.
 */
export async function listProjectOptions(): Promise<ProjectOptionDTO[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name")
    .is("deleted_at", null)
    // An archived project is not one to start a new client on; its own
    // Client access card still can, if that is ever really wanted.
    .neq("status", "archived")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}
