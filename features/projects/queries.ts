import "server-only";
import { cache } from "react";
import Decimal from "decimal.js";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import { getPackageNavLists } from "@/features/packages/queries";
import { env } from "@/lib/env";
import { todayIst } from "@/lib/dates";
import { outstandingByProject } from "@/features/billing/queries";
import { NO_ATTENTION, daysBetween, type ProjectAttention } from "./portfolio";
import {
  parseProjectStatus,
  parseRateVisibility,
  projectStatusLabel,
  type MemberRole,
  type ProjectStatus,
  type RateVisibility,
  type SetupFacts,
} from "./service";
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

/** The package count comes from getPackageNavLists — the very list the
 *  sidebar renders, through the role-shaped table/view for the EFFECTIVE role
 *  (see getPortfolio's own doc comment for why it must be the effective role
 *  under impersonation). It is cache()d, so the shell's own call for the same
 *  ids reuses this one instead of querying packages a second time (APX-26). */
async function fetchProjectRows(session: Session) {
  const effectiveRole = session.impersonating?.role ?? session.role;
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
  const [clientsRes, navLists] = await Promise.all([
    isAdmin
      ? supabase.from("clients").select("id, name").in("id", clientIds)
      : supabase.from("v_client_name").select("id, name").in("id", clientIds),
    getPackageNavLists(session, projectIds),
  ]);
  const { data: clients, error: clientErr } = clientsRes;
  if (clientErr) throw new Error(clientErr.message);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const packageCountByProject = new Map<string, number>(
    Object.entries(navLists).map(([projectId, list]) => [projectId, list.length])
  );

  return { projects: data, clientName, packageCountByProject };
}

type MoneyRow = { allocated: string; internal: string; committed: string };
const ZERO_MONEY: MoneyRow = { allocated: "0", internal: "0", committed: "0" };

async function getPortfolioForAdmin(session: Session): Promise<PortfolioAdmin> {
  const supabase = await createClient();
  const { projects, clientName, packageCountByProject } = await fetchProjectRows(session);

  // Summed in Postgres as numeric and returned as text (APX-52): the old
  // client-side sum over an unpaged v_package_rollup select was capped at
  // 1,000 packages and added money as binary floats. One row per project plus
  // a grand-total row whose project_id is null (`grouping sets`).
  const { data: money, error } = await supabase.rpc("rpc_portfolio_money", {
    p_project_ids: projects.map((p) => p.id),
  });
  if (error) throw new Error(error.message);

  const byProject = new Map<string, MoneyRow>();
  let totals: MoneyRow = ZERO_MONEY;
  for (const r of money ?? []) {
    if (r.project_id === null) totals = r;
    else byProject.set(r.project_id, r);
  }

  const projectCards: ProjectCardDTO[] = projects.map((p) => {
    const agg = byProject.get(p.id) ?? ZERO_MONEY;
    const internal = new Decimal(agg.internal);
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
      headlineAmount: agg.allocated,
      budgetUsedPct: internal.gt(0)
        ? new Decimal(agg.committed).div(internal).mul(100).toDecimalPlaces(0).toNumber()
        : 0,
    };
  });

  return {
    role: "money",
    stats: {
      totalAllocated: totals.allocated,
      totalInternal: totals.internal,
      committed: totals.committed,
      activeProjects: projects.filter((p) => p.status === "active").length,
    },
    projects: projectCards,
  };
}

async function getPortfolioForClient(session: Session): Promise<PortfolioClient> {
  const supabase = await createClient();
  const { projects, clientName, packageCountByProject } = await fetchProjectRows(session);

  const projectIds = projects.map((p) => p.id);
  // ui-guide.md §6.1: "Awaiting Your Approval" is samples AND bills — the
  // prototype's apPendAll + billsPendAll. approvals is is_member_of-gated
  // (a client decides their own project's approvals directly, §6.10), but
  // bills is admin-only on select — v_bill_client is the client-safe read.
  // The two counts are independent, so they go out together (APX-26).
  //
  // contract_value lives behind v_project_finance (admin or client only,
  // APX-09), not on projects, so a site session has no path to it at all.
  const [approvalsRes, billsRes, financeRes] = await Promise.all([
    supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .in("project_id", projectIds),
    supabase
      .from("v_bill_client")
      .select("id", { count: "exact", head: true })
      .eq("status", "submitted")
      .in("project_id", projectIds),
    supabase.from("v_project_finance").select("id, contract_value").in("id", projectIds),
  ]);
  if (approvalsRes.error) throw new Error(approvalsRes.error.message);
  if (billsRes.error) throw new Error(billsRes.error.message);
  if (financeRes.error) throw new Error(financeRes.error.message);
  const pendingApprovals = approvalsRes.count;
  const pendingBills = billsRes.count;

  const awaitingApproval = (pendingApprovals ?? 0) + (pendingBills ?? 0);

  // Strings, not Numbers: the total is summed with decimal.js (APX-52).
  const contractValue = new Map(financeRes.data.map((f) => [f.id, String(f.contract_value ?? 0)]));

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
    headlineAmount: contractValue.get(p.id) ?? "0",
    budgetUsedPct: null,
  }));

  return {
    role: "client",
    stats: {
      // decimal.js, not a float sum: a money total (APX-52).
      totalContractValue: projects
        .reduce((a, p) => a.plus(new Decimal(contractValue.get(p.id) ?? "0")), new Decimal(0))
        .toFixed(2),
      activeProjects: projects.filter((p) => p.status === "active").length,
      awaitingApproval,
    },
    projects: projectCards,
  };
}

async function getPortfolioForSite(session: Session): Promise<PortfolioSite> {
  const supabase = await createClient();
  const { projects, clientName, packageCountByProject } = await fetchProjectRows(session);
  const projectIds = projects.map((p) => p.id);

  // Independent reads, in parallel (APX-26). "In progress" is counted in
  // Postgres rather than by fetching every package row.
  const [inProgressRes, requestsRes] = await Promise.all([
    supabase
      .from("v_package_site")
      .select("id", { count: "exact", head: true })
      .eq("status", "in_progress")
      .in("project_id", projectIds),
    supabase
      .from("v_stock_request_site")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .in("project_id", projectIds),
  ]);
  if (inProgressRes.error) throw new Error(inProgressRes.error.message);
  if (requestsRes.error) throw new Error(requestsRes.error.message);
  const pendingRequests = requestsRes.count;

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
      packagesInProgress: inProgressRes.count ?? 0,
      pendingRequests: pendingRequests ?? 0,
    },
    projects: projectCards,
  };
}

export type Portfolio = PortfolioAdmin | PortfolioClient | PortfolioSite;

/** How far back "last site update" looks. Older than this reads as "no recent
 *  update" — it bounds the read instead of scanning every update ever posted. */
const UPDATE_LOOKBACK_DAYS = 60;

/**
 * The All Projects cards' attention badges (APX-48), for the whole portfolio
 * in a handful of queries rather than a handful per card. Every read goes
 * through the user's own RLS-bound client and is shaped by the EFFECTIVE role:
 *
 *   late tasks, pending approvals, last update  every role (no money)
 *   low stock                                   admin (v_inventory_status) and
 *                                               site (v_inventory_site); never
 *                                               a client (no stock visibility)
 *   outstanding ₹                               admin only, and only while
 *                                               BILLING_ENABLED
 *
 * Kept separate from `getPortfolio` because the app shell calls that on every
 * navigation; only the All Projects page needs these.
 */
export async function getPortfolioAttention(
  session: Session,
  projectIds: string[]
): Promise<Record<string, ProjectAttention>> {
  if (projectIds.length === 0) return {};
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "admin";
  const isClient = effectiveRole === "client";
  const supabase = await createClient();
  const today = todayIst();
  const lookback = isoDaysBefore(today, UPDATE_LOOKBACK_DAYS);

  const [late, approvals, updates, lowStock, outstanding] = await Promise.all([
    supabase
      .from("tasks")
      .select("project_id")
      .in("project_id", projectIds)
      .is("deleted_at", null)
      .lt("end_date", today)
      .lt("progress_pct", 100),
    supabase
      .from("approvals")
      .select("project_id, created_at")
      .in("project_id", projectIds)
      .eq("status", "pending")
      .is("deleted_at", null),
    supabase
      .from("daily_updates")
      .select("project_id, update_date")
      .in("project_id", projectIds)
      .is("deleted_at", null)
      .gte("update_date", lookback),
    isClient
      ? Promise.resolve(null)
      : isAdmin
        ? supabase
            .from("v_inventory_status")
            .select("project_id")
            .in("project_id", projectIds)
            .in("stock_status", ["low", "critical"])
        : supabase
            .from("v_inventory_site")
            .select("project_id")
            .in("project_id", projectIds)
            .in("stock_status", ["low", "critical"]),
    isAdmin && env.BILLING_ENABLED ? outstandingByProject(projectIds) : Promise.resolve(null),
  ]);
  if (late.error) throw new Error(late.error.message);
  if (approvals.error) throw new Error(approvals.error.message);
  if (updates.error) throw new Error(updates.error.message);
  if (lowStock?.error) throw new Error(lowStock.error.message);

  const result: Record<string, ProjectAttention> = {};
  for (const id of projectIds) {
    result[id] = {
      ...NO_ATTENTION,
      lowStock: lowStock ? 0 : null,
      outstanding: outstanding ? (outstanding[id] ?? 0) : null,
    };
  }
  const at = (id: string | null) => (id ? result[id] : undefined);

  for (const t of late.data) {
    const a = at(t.project_id);
    if (a) a.lateTasks += 1;
  }
  for (const ap of approvals.data) {
    const a = at(ap.project_id);
    if (!a) continue;
    a.pendingApprovals += 1;
    const age = daysBetween(todayIst(new Date(ap.created_at)), today);
    a.oldestApprovalDays = Math.max(a.oldestApprovalDays ?? 0, age);
  }
  for (const u of updates.data) {
    const a = at(u.project_id);
    if (!a) continue;
    const age = daysBetween(u.update_date, today);
    a.lastUpdateDays = a.lastUpdateDays == null ? age : Math.min(a.lastUpdateDays, age);
  }
  for (const row of lowStock?.data ?? []) {
    const a = at(row.project_id);
    if (a && a.lowStock != null) a.lowStock += 1;
  }
  return result;
}

/** `yyyy-MM-dd`, `days` before `iso`, on the calendar Y/M/D (no timezone). */
function isoDaysBefore(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) - days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * Dispatches on the EFFECTIVE role (session.impersonating?.role ?? session.role),
 * not the real one directly. RLS itself does not change under impersonation —
 * an admin previewing "client" still passes is_admin() at the database layer,
 * since the JWT is unaffected. The preview only works because the APPLICATION
 * chooses to run the client-shaped query instead of the admin one; getting this
 * dispatch wrong would defeat D20's entire point.
 */
export const getPortfolio = cache(async (session: Session): Promise<Portfolio> => {
  // React cache(): the app shell and the home/inventory page both ask for the
  // portfolio in the same render; they now share one set of queries (APX-26).
  const effectiveRole = session.impersonating?.role ?? session.role;
  if (effectiveRole === "admin") return getPortfolioForAdmin(session);
  if (effectiveRole === "client") return getPortfolioForClient(session);
  return getPortfolioForSite(session);
});

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
  /** The enum value behind `status` (APX-11/41): the status control and the
   *  read-only rule key on this, never on the display label. */
  statusKey: ProjectStatus;
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
    statusKey: parseProjectStatus(p.status) ?? "planning",
    progressPct: p.progress_pct,
    rateVisibility: parseRateVisibility(p.rate_visibility),
  };
}

/**
 * Just the status, for the read-only rule (APX-41) on every page and layout
 * under a project. Readable by every member (projects_select), and it carries
 * no money. `cache`: the layout, the banner and the page each ask during one
 * request, and that is one round trip, not three.
 */
export const getProjectStatus = cache(async (projectId: string): Promise<ProjectStatus | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("status")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseProjectStatus(data?.status);
});

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
  const [billsRes, approvalsRes] = await Promise.all([
    supabase.from("v_bill_client").select("status, net_payable").eq("project_id", projectId),
    supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "pending"),
  ]);
  const { data: bills, error } = billsRes;
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

  const { count: approvalsPending, error: apErr } = approvalsRes;
  if (apErr) throw new Error(apErr.message);

  return { billedNet, paidNet, billsSubmitted, approvalsPending: approvalsPending ?? 0 };
}

/** Site dashboard's "Pending Requests" / "To Receive" extra stats (ui-guide
 *  §6.2). "Packages in Progress" comes from getPackagesForProject's own rows
 *  instead — not re-queried here. */
export type SiteStockStats = { pendingRequests: number; toReceive: number };

export async function getSiteStockStats(projectId: string): Promise<SiteStockStats> {
  const supabase = await createClient();
  const [pendingRes, orderedRes] = await Promise.all([
    supabase
      .from("v_stock_request_site")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "pending"),
    supabase
      .from("v_stock_request_site")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "ordered"),
  ]);
  const { count: pendingRequests, error } = pendingRes;
  if (error) throw new Error(error.message);
  const { count: toReceive, error: err2 } = orderedRes;
  if (err2) throw new Error(err2.message);

  return { pendingRequests: pendingRequests ?? 0, toReceive: toReceive ?? 0 };
}

/** One client login, as the project dashboard's Client access card lists it. */
export type ClientLoginDTO = { id: string; fullName: string; email: string | null };

/** A client login on this project, with how many live projects it can see in
 *  all — the Remove confirm warns when this is its only one (D51). */
export type ClientMemberDTO = ClientLoginDTO & { projectCount: number };

export type ProjectClientAccess = {
  /** Client logins that can see this project. */
  members: ClientMemberDTO[];
  /** Client logins in the org that cannot see it yet — "Add existing client". */
  others: ClientLoginDTO[];
};

/** The Site team card's shape (APX-12) — the same as Client access, for the
 *  org's Site Supervisors. */
export type ProjectSiteTeam = ProjectClientAccess;

/**
 * The profiles of one role that can see this project, and the ones that
 * cannot yet. Owner/admin only — the page calls it for those roles alone,
 * and both reads are RLS-scoped (`profiles_select` to the org, `pm_select`
 * via is_member_of, which is true for every project for an admin). profiles
 * carries no money columns. A deactivated login is never offered as one to
 * add, though a deactivated member is still listed so it can be removed.
 */
async function projectMembersOfRole(projectId: string, role: MemberRole): Promise<ProjectClientAccess> {
  const supabase = await createClient();
  const [profiles, members] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, is_active")
      .eq("role", role)
      .is("deleted_at", null)
      .order("full_name", { ascending: true }),
    supabase.from("project_members").select("profile_id").eq("project_id", projectId),
  ]);
  if (profiles.error) throw new Error(profiles.error.message);
  if (members.error) throw new Error(members.error.message);

  const memberIds = new Set(members.data.map((m) => m.profile_id));
  const ofRole = profiles.data.filter((p) => memberIds.has(p.id)).map((p) => p.id);
  const projectsByProfile = await memberProjectMap(ofRole);
  const result: ProjectClientAccess = { members: [], others: [] };
  for (const p of profiles.data) {
    const dto = { id: p.id, fullName: p.full_name, email: p.email };
    if (memberIds.has(p.id)) {
      result.members.push({ ...dto, projectCount: projectsByProfile.get(p.id)?.length ?? 0 });
    } else if (p.is_active) {
      result.others.push(dto);
    }
  }
  return result;
}

/** D51: the project's client logins, and the ones that could be added. */
export async function getProjectClientAccess(projectId: string): Promise<ProjectClientAccess> {
  return projectMembersOfRole(projectId, "client");
}

/** APX-12: the project's Site Supervisors, and the ones that could be added. */
export async function getProjectSiteTeam(projectId: string): Promise<ProjectSiteTeam> {
  return projectMembersOfRole(projectId, "site");
}

/** A project a client login or Site Supervisor can see, as the Users page
 *  lists it. */
export type ClientProjectDTO = { id: string; code: string; name: string };

/**
 * The live projects each of `profileIds` is a member of, by profile id. Owner/
 * admin callers only (the Client access card and the Users page): pm_select
 * lets an admin read every membership row in the org, and projects_select is
 * org-scoped. id, code and name only — no money column.
 */
async function memberProjectMap(profileIds: string[]): Promise<Map<string, ClientProjectDTO[]>> {
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

/** For the Users page: each listed client login's or Site Supervisor's
 *  projects (D51, APX-12). */
export async function listMemberProjects(profileIds: string[]): Promise<Record<string, ClientProjectDTO[]>> {
  return Object.fromEntries(await memberProjectMap(profileIds));
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

/**
 * What the setup checklist (APX-70) needs to know about one project. Admin
 * only — the dashboard renders the card for admins alone — and every read is
 * RLS-scoped: packages and phases are admin-only base tables, which is why
 * this must never be called for another role. Only `allocated_amount` is read
 * from packages (to tell "has a budget"), and it never leaves this function
 * as anything but a figure the admin already sees in the Packages table.
 */
export async function getProjectSetupFacts(projectId: string): Promise<SetupFacts & { code: string }> {
  const supabase = await createClient();
  const [project, packages, phases, tasks, members] = await Promise.all([
    supabase.from("projects").select("status, code").eq("id", projectId).is("deleted_at", null).maybeSingle(),
    supabase
      .from("packages")
      .select("id, seq_no, name, allocated_amount")
      .eq("project_id", projectId)
      .is("deleted_at", null),
    supabase.from("phases").select("package_id").eq("project_id", projectId).is("deleted_at", null),
    supabase.from("tasks").select("package_id").eq("project_id", projectId).is("deleted_at", null),
    supabase.from("project_members").select("profile_id").eq("project_id", projectId),
  ]);
  if (project.error) throw new Error(project.error.message);
  if (packages.error) throw new Error(packages.error.message);
  if (phases.error) throw new Error(phases.error.message);
  if (tasks.error) throw new Error(tasks.error.message);
  if (members.error) throw new Error(members.error.message);

  const countByPackage = (rows: { package_id: string }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.package_id, (m.get(r.package_id) ?? 0) + 1);
    return m;
  };
  const phasesBy = countByPackage(phases.data);
  const tasksBy = countByPackage(tasks.data);

  const memberIds = members.data.map((m) => m.profile_id);
  let siteMembers = 0;
  let clientMembers = 0;
  if (memberIds.length > 0) {
    const { data: roles, error } = await supabase
      .from("profiles")
      .select("role")
      .in("id", memberIds)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    siteMembers = roles.filter((p) => p.role === "site").length;
    clientMembers = roles.filter((p) => p.role === "client").length;
  }

  return {
    code: project.data?.code ?? "",
    status: project.data?.status ?? "planning",
    packages: packages.data.map((p) => ({
      id: p.id,
      seqNo: p.seq_no,
      name: p.name,
      allocated: Number(p.allocated_amount),
      phases: phasesBy.get(p.id) ?? 0,
      tasks: tasksBy.get(p.id) ?? 0,
    })),
    siteMembers,
    clientMembers,
  };
}
