import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import { packageStatusLabel } from "./service";

/**
 * Three separate functions per query, not one with a role ternary on the
 * select list (build/04-projects-packages-phases.md §7's guardrail). Each
 * DTO's shape makes the forbidden columns for that role simply not exist —
 * a discriminated union on `role`, so a component that tries to read
 * `.internal` off a site row fails to compile, not just fails to render.
 */

function effectiveRoleOf(session: Session): "owner" | "admin" | "site" | "client" {
  return session.impersonating?.role ?? session.role;
}

async function leadNames(profileIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(profileIds.filter((id): id is string => id != null))];
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map(data.map((p) => [p.id, p.full_name]));
}

/**
 * "To assign" is the prototype's own placeholder (lib/data.ts) for a package
 * with no lead, rendered unconditionally — never omitted — by ModuleTable.
 * Found as a real visual diff against `proto-v1` while verifying this build:
 * a package genuinely unassigned in both datasets rendered no lead line at
 * all here, one line shorter per row. Not every prototype lead is
 * representable now — a vendor name like "Laxmi Multi Services" isn't a
 * staff profile, so `lead_profile_id` has nothing to point at — but "no lead
 * yet" always is, and every call site below defaults to it the same way.
 */
const NO_LEAD = "To assign";

// ── Package rows for a project's Packages table (§6.4) ──────────────────────

export type PackageRowDTO = {
  id: string;
  seqNo: number;
  name: string;
  lead: string;
  status: string;
  statusLabel: string;
  progressPct: number;
} & (
  | {
      role: "money";
      allocated: number;
      internal: number;
      committed: number;
      remaining: number;
      usedPct: number;
      isOverBudget: boolean;
    }
  | { role: "client"; contractValue: number }
  | { role: "site"; openRequests: number; phaseCount: number }
);

export type PackagesForProject =
  | {
      role: "money";
      packages: PackageRowDTO[];
      totals: { allocated: number; internal: number; committed: number; remaining: number };
    }
  | { role: "client"; packages: PackageRowDTO[]; totals: { allocated: number } }
  | { role: "site"; packages: PackageRowDTO[] };

export async function getPackagesForProject(
  session: Session,
  projectId: string
): Promise<PackagesForProject> {
  const effectiveRole = effectiveRoleOf(session);
  if (effectiveRole === "owner" || effectiveRole === "admin") return getPackagesForProjectAdmin(projectId);
  if (effectiveRole === "client") return getPackagesForProjectClient(projectId);
  return getPackagesForProjectSite(projectId);
}

async function getPackagesForProjectAdmin(projectId: string): Promise<PackagesForProject> {
  const supabase = await createClient();
  const { data: packages, error } = await supabase
    .from("packages")
    .select("id, seq_no, name, lead_profile_id, status, progress_pct")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: rollups, error: rollupErr } = await supabase
    .from("v_package_rollup")
    .select("package_id, allocated_amount, internal_amount, committed, remaining, used_pct, is_over_budget")
    .in(
      "package_id",
      packages.map((p) => p.id)
    );
  if (rollupErr) throw new Error(rollupErr.message);
  const rollupById = new Map(rollups.map((r) => [r.package_id, r]));
  const leads = await leadNames(packages.map((p) => p.lead_profile_id));

  let totalAllocated = 0,
    totalInternal = 0,
    totalCommitted = 0;
  const rows: PackageRowDTO[] = packages.map((p) => {
    const r = rollupById.get(p.id);
    const allocated = Number(r?.allocated_amount ?? 0);
    const internal = Number(r?.internal_amount ?? 0);
    const committed = Number(r?.committed ?? 0);
    totalAllocated += allocated;
    totalInternal += internal;
    totalCommitted += committed;
    return {
      id: p.id,
      seqNo: p.seq_no,
      name: p.name,
      lead: p.lead_profile_id ? (leads.get(p.lead_profile_id) ?? NO_LEAD) : NO_LEAD,
      status: p.status,
      statusLabel: packageStatusLabel(p.status),
      progressPct: p.progress_pct,
      role: "money",
      allocated,
      internal,
      committed,
      remaining: Number(r?.remaining ?? internal - committed),
      usedPct: Number(r?.used_pct ?? 0),
      isOverBudget: r?.is_over_budget ?? false,
    };
  });

  return {
    role: "money",
    packages: rows,
    totals: {
      allocated: totalAllocated,
      internal: totalInternal,
      committed: totalCommitted,
      remaining: totalInternal - totalCommitted,
    },
  };
}

async function getPackagesForProjectClient(projectId: string): Promise<PackagesForProject> {
  const supabase = await createClient();
  const { data: packages, error } = await supabase
    .from("v_package_client")
    .select("id, seq_no, name, lead_profile_id, contract_value, status, progress_pct")
    .eq("project_id", projectId)
    .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);

  const leads = await leadNames(packages.map((p) => p.lead_profile_id));
  let totalAllocated = 0;
  const rows: PackageRowDTO[] = packages.map((p) => {
    const contractValue = Number(p.contract_value ?? 0);
    totalAllocated += contractValue;
    return {
      id: p.id ?? "",
      seqNo: p.seq_no ?? 0,
      name: p.name ?? "",
      lead: p.lead_profile_id ? (leads.get(p.lead_profile_id) ?? NO_LEAD) : NO_LEAD,
      status: p.status ?? "not_started",
      statusLabel: packageStatusLabel(p.status ?? "not_started"),
      progressPct: p.progress_pct ?? 0,
      role: "client",
      contractValue,
    };
  });

  return { role: "client", packages: rows, totals: { allocated: totalAllocated } };
}

async function getPackagesForProjectSite(projectId: string): Promise<PackagesForProject> {
  const supabase = await createClient();
  const { data: packages, error } = await supabase
    .from("v_package_site")
    .select("id, seq_no, name, lead_profile_id, status, progress_pct, open_requests, phase_count")
    .eq("project_id", projectId)
    .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);

  const leads = await leadNames(packages.map((p) => p.lead_profile_id));
  const rows: PackageRowDTO[] = packages.map((p) => ({
    id: p.id ?? "",
    seqNo: p.seq_no ?? 0,
    name: p.name ?? "",
    lead: p.lead_profile_id ? (leads.get(p.lead_profile_id) ?? NO_LEAD) : NO_LEAD,
    status: p.status ?? "not_started",
    statusLabel: packageStatusLabel(p.status ?? "not_started"),
    progressPct: p.progress_pct ?? 0,
    role: "site",
    openRequests: p.open_requests ?? 0,
    phaseCount: p.phase_count ?? 0,
  }));

  return { role: "site", packages: rows };
}

// ── Package names for the Sidebar / Header nav (§8.2) ───────────────────────

/** Just enough of a package to name it in the nav. No money column of any
 *  kind, for any role. */
export type PackageNavItem = { id: string; name: string };

/**
 * The package sub-list under the Sidebar's Packages item, and the package
 * name in the Header's breadcrumb — both of which read `lib/data.ts`'s mock
 * `modules` array until now, so both were empty for every real project.
 *
 * Keyed by project, and fetched for the whole portfolio in one query, because
 * the app shell that renders the Sidebar is a layout: Next.js does not
 * re-render a layout on navigation, so a list scoped to "the project open
 * right now" would be whichever project the tab was first opened on. The
 * per-project `getPackagesForProject` above is the wrong tool here — it also
 * reads rollups and lead names, three queries per project, for two columns
 * this nav needs.
 *
 * Same role split as every other package read: the base table for admin, the
 * column-omitting views otherwise.
 */
export async function getPackageNavLists(
  session: Session,
  projectIds: string[]
): Promise<Record<string, PackageNavItem[]>> {
  if (projectIds.length === 0) return {};
  const effectiveRole = effectiveRoleOf(session);
  const supabase = await createClient();

  const { data, error } =
    effectiveRole === "owner" || effectiveRole === "admin"
      ? await supabase
          .from("packages")
          .select("id, project_id, name")
          .in("project_id", projectIds)
          .is("deleted_at", null)
          .order("seq_no", { ascending: true })
      : effectiveRole === "client"
        ? await supabase
            .from("v_package_client")
            .select("id, project_id, name")
            .in("project_id", projectIds)
            .order("seq_no", { ascending: true })
        : await supabase
            .from("v_package_site")
            .select("id, project_id, name")
            .in("project_id", projectIds)
            .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);

  const byProject: Record<string, PackageNavItem[]> = {};
  for (const row of data) {
    if (!row.id || !row.project_id) continue;
    (byProject[row.project_id] ??= []).push({ id: row.id, name: row.name ?? "" });
  }
  return byProject;
}

// ── One package's detail header + stat row (§6.5) ───────────────────────────

export type PackageDetailDTO = {
  id: string;
  seqNo: number;
  name: string;
  lead: string;
  status: string;
  statusLabel: string;
  progressPct: number;
} & (
  | {
      role: "money";
      allocated: number;
      internal: number;
      committed: number;
      remaining: number;
      usedPct: number;
      updatedAt: string;
    }
  | { role: "client"; contractValue: number }
  | { role: "site" }
);

export async function getPackageDetail(
  session: Session,
  projectId: string,
  packageId: string
): Promise<PackageDetailDTO | null> {
  const effectiveRole = effectiveRoleOf(session);
  if (effectiveRole === "owner" || effectiveRole === "admin") return getPackageDetailAdmin(packageId);
  if (effectiveRole === "client") return getPackageDetailClient(projectId, packageId);
  return getPackageDetailSite(projectId, packageId);
}

async function getPackageDetailAdmin(packageId: string): Promise<PackageDetailDTO | null> {
  const supabase = await createClient();
  const { data: p, error } = await supabase
    .from("packages")
    .select("id, seq_no, name, lead_profile_id, status, progress_pct, updated_at")
    .eq("id", packageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) return null;

  const { data: r, error: rollupErr } = await supabase
    .from("v_package_rollup")
    .select("allocated_amount, internal_amount, committed, remaining, used_pct")
    .eq("package_id", packageId)
    .maybeSingle();
  if (rollupErr) throw new Error(rollupErr.message);

  const leads = await leadNames([p.lead_profile_id]);
  return {
    id: p.id,
    seqNo: p.seq_no,
    name: p.name,
    lead: p.lead_profile_id ? (leads.get(p.lead_profile_id) ?? NO_LEAD) : NO_LEAD,
    status: p.status,
    statusLabel: packageStatusLabel(p.status),
    progressPct: p.progress_pct,
    role: "money",
    allocated: Number(r?.allocated_amount ?? 0),
    internal: Number(r?.internal_amount ?? 0),
    committed: Number(r?.committed ?? 0),
    remaining: Number(r?.remaining ?? 0),
    usedPct: Number(r?.used_pct ?? 0),
    updatedAt: p.updated_at,
  };
}

async function getPackageDetailClient(
  projectId: string,
  packageId: string
): Promise<PackageDetailDTO | null> {
  const supabase = await createClient();
  const { data: p, error } = await supabase
    .from("v_package_client")
    .select("id, seq_no, name, lead_profile_id, contract_value, status, progress_pct")
    .eq("project_id", projectId)
    .eq("id", packageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!p?.id) return null;

  const leads = await leadNames([p.lead_profile_id]);
  return {
    id: p.id,
    seqNo: p.seq_no ?? 0,
    name: p.name ?? "",
    lead: p.lead_profile_id ? (leads.get(p.lead_profile_id) ?? NO_LEAD) : NO_LEAD,
    status: p.status ?? "not_started",
    statusLabel: packageStatusLabel(p.status ?? "not_started"),
    progressPct: p.progress_pct ?? 0,
    role: "client",
    contractValue: Number(p.contract_value ?? 0),
  };
}

async function getPackageDetailSite(projectId: string, packageId: string): Promise<PackageDetailDTO | null> {
  const supabase = await createClient();
  const { data: p, error } = await supabase
    .from("v_package_site")
    .select("id, seq_no, name, lead_profile_id, status, progress_pct")
    .eq("project_id", projectId)
    .eq("id", packageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!p?.id) return null;

  const leads = await leadNames([p.lead_profile_id]);
  return {
    id: p.id,
    seqNo: p.seq_no ?? 0,
    name: p.name ?? "",
    lead: p.lead_profile_id ? (leads.get(p.lead_profile_id) ?? NO_LEAD) : NO_LEAD,
    status: p.status ?? "not_started",
    statusLabel: packageStatusLabel(p.status ?? "not_started"),
    progressPct: p.progress_pct ?? 0,
    role: "site",
  };
}

// ── Phases for the Budget/Phases tab (§6.5) ─────────────────────────────────

export type PhaseRowDTO = { id: string; seqNo: number; name: string } & (
  | { role: "money"; allocated: number; internal: number; committed: number; remaining: number }
  | { role: "client"; contractValue: number; isComplete: boolean }
  | { role: "site"; requests: number }
);

export type PhasesForPackage =
  | {
      role: "money";
      phases: PhaseRowDTO[];
      totals: { allocated: number; internal: number; committed: number };
    }
  | { role: "client"; phases: PhaseRowDTO[]; totals: { allocated: number } }
  | { role: "site"; phases: PhaseRowDTO[] };

export async function getPhasesForPackage(
  session: Session,
  projectId: string,
  packageId: string
): Promise<PhasesForPackage> {
  const effectiveRole = effectiveRoleOf(session);
  if (effectiveRole === "owner" || effectiveRole === "admin") return getPhasesForPackageAdmin(packageId);
  if (effectiveRole === "client") return getPhasesForPackageClient(projectId, packageId);
  return getPhasesForPackageSite(projectId, packageId);
}

const PHASE_COMMITTED_STATUSES = ["approved", "ordered", "delivered"] as const;

async function getPhasesForPackageAdmin(packageId: string): Promise<PhasesForPackage> {
  const supabase = await createClient();
  const { data: phases, error } = await supabase
    .from("phases")
    .select("id, seq_no, name, allocated_amount, internal_amount")
    .eq("package_id", packageId)
    .is("deleted_at", null)
    .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);

  // No v_phase_rollup exists (only the package-level v_package_rollup) — a
  // per-phase committed figure is a straight group-by over stock_requests,
  // an admin-only base table, computed here rather than adding a single-use
  // view for one column. See features/packages/service.ts's computeCommitted
  // for the pure formula this mirrors (approved/ordered/delivered only).
  const { data: requests, error: reqErr } = await supabase
    .from("stock_requests")
    .select("phase_id, qty, rate, status")
    .eq("package_id", packageId)
    .in("status", PHASE_COMMITTED_STATUSES)
    .is("deleted_at", null);
  if (reqErr) throw new Error(reqErr.message);

  const committedByPhase = new Map<string, number>();
  for (const r of requests) {
    if (!r.phase_id) continue;
    committedByPhase.set(r.phase_id, (committedByPhase.get(r.phase_id) ?? 0) + r.qty * (r.rate ?? 0));
  }

  let totalAllocated = 0,
    totalInternal = 0,
    totalCommitted = 0;
  const rows: PhaseRowDTO[] = phases.map((ph) => {
    const allocated = Number(ph.allocated_amount);
    const internal = Number(ph.internal_amount);
    const committed = committedByPhase.get(ph.id) ?? 0;
    totalAllocated += allocated;
    totalInternal += internal;
    totalCommitted += committed;
    return {
      id: ph.id,
      seqNo: ph.seq_no,
      name: ph.name,
      role: "money",
      allocated,
      internal,
      committed,
      remaining: internal - committed,
    };
  });

  return {
    role: "money",
    phases: rows,
    totals: { allocated: totalAllocated, internal: totalInternal, committed: totalCommitted },
  };
}

async function getPhasesForPackageClient(projectId: string, packageId: string): Promise<PhasesForPackage> {
  const supabase = await createClient();
  const { data: phases, error } = await supabase
    .from("v_phase_client")
    .select("id, seq_no, name, contract_value, is_complete")
    .eq("project_id", projectId)
    .eq("package_id", packageId)
    .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);

  let totalAllocated = 0;
  const rows: PhaseRowDTO[] = phases.map((ph) => {
    const contractValue = Number(ph.contract_value ?? 0);
    totalAllocated += contractValue;
    return {
      id: ph.id ?? "",
      seqNo: ph.seq_no ?? 0,
      name: ph.name ?? "",
      role: "client",
      contractValue,
      isComplete: ph.is_complete ?? false,
    };
  });

  return { role: "client", phases: rows, totals: { allocated: totalAllocated } };
}

async function getPhasesForPackageSite(projectId: string, packageId: string): Promise<PhasesForPackage> {
  const supabase = await createClient();
  const { data: phases, error } = await supabase
    .from("v_phase_site")
    .select("id, seq_no, name")
    .eq("project_id", projectId)
    .eq("package_id", packageId)
    .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);

  const phaseIds = phases.map((ph) => ph.id).filter((id): id is string => id != null);
  const { data: requests, error: reqErr } =
    phaseIds.length === 0
      ? { data: [] as { phase_id: string | null }[], error: null }
      : await supabase.from("v_stock_request_site").select("phase_id").in("phase_id", phaseIds);
  if (reqErr) throw new Error(reqErr.message);
  const countByPhase = new Map<string, number>();
  for (const r of requests) {
    if (!r.phase_id) continue;
    countByPhase.set(r.phase_id, (countByPhase.get(r.phase_id) ?? 0) + 1);
  }

  const rows: PhaseRowDTO[] = phases.map((ph) => ({
    id: ph.id ?? "",
    seqNo: ph.seq_no ?? 0,
    name: ph.name ?? "",
    role: "site",
    requests: ph.id ? (countByPhase.get(ph.id) ?? 0) : 0,
  }));

  return { role: "site", phases: rows };
}
