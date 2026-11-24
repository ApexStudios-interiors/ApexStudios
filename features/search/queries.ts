import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import { capResults, ilikeAnyFilter, type SearchResultDTO } from "./service";
import { packagePath, projectPath } from "@/lib/routing/paths";
import { isUuid } from "@/lib/routing/slug";

/**
 * build/07-stock-inventory-notifications.md §2.7. Each entity goes through
 * its OWN role-scoped query — the same views the rest of the app already
 * uses — so a client searching "marble" cannot learn a stock request or an
 * internal bill exists: the query for that category is never run for that
 * role, not merely filtered after the fact. Uses the EFFECTIVE role
 * (impersonating ?? real), matching every other read in this codebase
 * (Build 05: impersonation only ever shapes reads).
 *
 * APX-65 (D72, 2026-11-24): while an admin previews a role, every category is
 * also scoped to the PREVIEWED project. The preview runs on the admin's own
 * login, so RLS alone would return every project's rows — not what that
 * client or supervisor would find. Central-store inventory (no project) stays
 * in, because the previewed role would find it too.
 */

/** Escapes `ilike`'s own wildcard characters (`%`, `_`, and the escape
 *  character `\` itself) before wrapping the user's literal text in `%...%`
 *  — found live via review: an unescaped search for e.g. "M_20 grade
 *  concrete" let Postgres treat `_` as "match any single character,"
 *  matching far more than the literal substring typed. */
function pattern(query: string): string {
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

export async function searchAll(session: Session, query: string): Promise<SearchResultDTO[]> {
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "admin";
  const isClient = effectiveRole === "client";
  const isSite = effectiveRole === "site";
  const supabase = await createClient();
  const q = pattern(query);
  const scope = session.impersonating?.projectId ?? null;

  const [projects, packages, stockRequests, approvals, bills, inventory, users] = await Promise.all([
    searchProjects(supabase, q, scope),
    searchPackages(supabase, q, isAdmin, isClient, scope),
    isClient ? Promise.resolve([]) : searchStockRequests(supabase, query, isAdmin, scope),
    searchApprovals(supabase, query, scope),
    isSite ? Promise.resolve([]) : searchBills(supabase, q, isAdmin, scope),
    isClient ? Promise.resolve([]) : searchInventory(supabase, q, isAdmin, scope),
    // Never while previewing: a preview is never of an admin (D66), so
    // `isAdmin` is false whenever `scope` is set.
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

/** The previewed project, or null outside a preview (APX-65). */
type Scope = string | null;

/** Narrows a query to the previewed project when there is one. Generic over
 *  the builder so each call keeps its own row type. */
function inScope<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  scope: Scope,
  column = "project_id"
): T {
  return scope ? query.eq(column, scope) : query;
}

async function searchProjects(supabase: Supa, q: string, scope: Scope): Promise<SearchResultDTO[]> {
  const { data, error } = await inScope(
    supabase.from("projects").select("id, name, location, code").ilike("name", q),
    scope,
    "id"
  ).limit(5);
  if (error) throw new Error(error.message);
  return data.map((p) => ({
    id: p.id,
    category: "Projects" as const,
    text: p.name,
    sub: p.location ?? "",
    href: p.code ? projectPath({ code: p.code }) : `/projects/${p.id}`,
    projectId: p.id,
  }));
}

type ProjectRefRow = { name: string; code: string };

/**
 * Name AND code for each project in the result set. The code costs nothing
 * extra here — one more column on a query already being made — and is what
 * lets every href below be the canonical `/projects/bhel-nch/...` rather than
 * a `/projects/<uuid>/...` that middleware answers with a redirect.
 */
async function projectRefs(supabase: Supa, projectIds: string[]): Promise<Map<string, ProjectRefRow>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("projects").select("id, name, code").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map(data.map((p) => [p.id, { name: p.name, code: p.code }]));
}

/**
 * Canonical href, with a UUID fallback.
 *
 * The fallback is not dead code: `projectRefs` reads through the caller's own
 * RLS-scoped client, so a row whose project the search surfaced but whose
 * `projects` row the reader cannot select would have no code here. A UUID
 * link still works — middleware redirects it — so the result stays clickable
 * rather than broken. It just costs the extra request this change exists to
 * avoid, which is the right trade for a case that should not happen.
 */
function sectionHref(ref: ProjectRefRow | undefined, projectId: string, rest: string): string {
  // `ref?.code`, not just `ref`: a row can come back with the project present
  // but its code not selectable by this reader.
  return ref?.code ? projectPath({ code: ref.code }, rest) : `/projects/${projectId}${rest}`;
}

function packageHref(
  ref: ProjectRefRow | undefined,
  projectId: string,
  packageId: string,
  name: string,
  seqNo: number
): string {
  if (!ref?.code) return `/projects/${projectId}/packages/${packageId}`;
  // `ambiguous: true` unconditionally: this result set holds at most five
  // packages matching a search term and cannot see the rest of the project,
  // so it cannot know whether the name collides. The suffixed form resolves
  // either way, which a bare name would not if a twin existed.
  return packagePath({ code: ref.code }, { name, seqNo, ambiguous: true });
}

async function searchPackages(
  supabase: Supa,
  q: string,
  isAdmin: boolean,
  isClient: boolean,
  scope: Scope
): Promise<SearchResultDTO[]> {
  type Row = { id: string; name: string; project_id: string; seq_no: number };
  let rows: Row[];
  if (isAdmin) {
    const { data, error } = await inScope(
      supabase.from("packages").select("id, name, project_id, seq_no").ilike("name", q),
      scope
    ).limit(5);
    if (error) throw new Error(error.message);
    rows = data;
  } else if (isClient) {
    const { data, error } = await inScope(
      supabase.from("v_package_client").select("id, name, project_id, seq_no").ilike("name", q),
      scope
    ).limit(5);
    if (error) throw new Error(error.message);
    // The view's own column types come back nullable even though every one
    // of these is populated on every real row (same cast Build 05's
    // schedule queries make for v_package_site/v_phase_site).
    rows = data as Row[];
  } else {
    const { data, error } = await inScope(
      supabase.from("v_package_site").select("id, name, project_id, seq_no").ilike("name", q),
      scope
    ).limit(5);
    if (error) throw new Error(error.message);
    rows = data as Row[];
  }
  const refs = await projectRefs(
    supabase,
    rows.map((r) => r.project_id)
  );
  return rows.map((r) => ({
    id: r.id,
    category: "Packages" as const,
    text: r.name,
    sub: refs.get(r.project_id)?.name ?? "",
    href: packageHref(refs.get(r.project_id), r.project_id, r.id, r.name, r.seq_no),
    projectId: r.project_id,
  }));
}

/**
 * APX-64: matched on the material name OR the ref number ("SR-BHEL-NCH-014"),
 * since staff quote the ref on calls. Takes the RAW query: `ilikeAnyFilter`
 * does its own escaping for the `or=` syntax, which differs from `pattern`'s.
 */
async function searchStockRequests(
  supabase: Supa,
  query: string,
  isAdmin: boolean,
  scope: Scope
): Promise<SearchResultDTO[]> {
  type Row = { id: string; ref_no: string; material_name: string; project_id: string };
  const filter = ilikeAnyFilter(["material_name", "ref_no"], query);
  const { data, error } = isAdmin
    ? await inScope(
        supabase
          .from("stock_requests")
          .select("id, ref_no, material_name, project_id")
          .or(filter)
          .is("deleted_at", null),
        scope
      ).limit(5)
    : await inScope(
        supabase.from("v_stock_request_site").select("id, ref_no, material_name, project_id").or(filter),
        scope
      ).limit(5);
  if (error) throw new Error(error.message);
  const rows = data as Row[];
  const refs = await projectRefs(
    supabase,
    rows.map((r) => r.project_id)
  );
  return rows.map((r) => ({
    id: r.id,
    category: "Stock Requests" as const,
    text: r.material_name,
    sub: `${r.ref_no} · ${refs.get(r.project_id)?.name ?? ""}`,
    href: sectionHref(refs.get(r.project_id), r.project_id, "/stock"),
    projectId: r.project_id,
  }));
}

/** APX-64: matched on the item OR the ref number ("AP-BHEL-NCH-007"). */
async function searchApprovals(supabase: Supa, query: string, scope: Scope): Promise<SearchResultDTO[]> {
  const { data, error } = await inScope(
    supabase
      .from("approvals")
      .select("id, ref_no, item, project_id")
      .or(ilikeAnyFilter(["item", "ref_no"], query))
      .is("deleted_at", null),
    scope
  ).limit(5);
  if (error) throw new Error(error.message);
  const refs = await projectRefs(
    supabase,
    data.map((a) => a.project_id)
  );
  return data.map((a) => ({
    id: a.id,
    category: "Approvals" as const,
    text: a.item,
    sub: `${a.ref_no} · ${refs.get(a.project_id)?.name ?? ""}`,
    href: sectionHref(refs.get(a.project_id), a.project_id, "/approvals"),
    projectId: a.project_id,
  }));
}

async function searchBills(
  supabase: Supa,
  q: string,
  isAdmin: boolean,
  scope: Scope
): Promise<SearchResultDTO[]> {
  type Row = { id: string; bill_no: string; project_id: string };
  const { data, error } = isAdmin
    ? await inScope(
        supabase.from("bills").select("id, bill_no, project_id").ilike("bill_no", q),
        scope
      ).limit(5)
    : // A client never sees a draft: the same filter as their Bills list
      // (getBillsPageForClient) and bill detail, so search finds only bills
      // the client can open.
      await inScope(
        supabase
          .from("v_bill_client")
          .select("id, bill_no, project_id")
          .ilike("bill_no", q)
          .neq("status", "draft"),
        scope
      ).limit(5);
  if (error) throw new Error(error.message);
  const rows = data as Row[];
  const refs = await projectRefs(
    supabase,
    rows.map((r) => r.project_id)
  );
  return rows.map((r) => ({
    id: r.id,
    category: "Bills" as const,
    text: r.bill_no,
    sub: refs.get(r.project_id)?.name ?? "",
    href: sectionHref(refs.get(r.project_id), r.project_id, "/billing"),
    projectId: r.project_id,
  }));
}

async function searchInventory(
  supabase: Supa,
  q: string,
  isAdmin: boolean,
  scope: Scope
): Promise<SearchResultDTO[]> {
  type Row = { id: string; name: string; project_id: string | null };
  const base = isAdmin
    ? supabase.from("v_inventory_status").select("id, name, project_id").ilike("name", q)
    : supabase.from("v_inventory_site").select("id, name, project_id").ilike("name", q);
  // The previewed project's items plus the central store's (project_id null),
  // which that role would also find. Only a UUID is ever interpolated into
  // the `or` string; anything else falls back to a plain `eq`, which matches
  // nothing rather than reshaping the filter.
  const scoped = !scope
    ? base
    : isUuid(scope)
      ? base.or(`project_id.eq.${scope},project_id.is.null`)
      : base.eq("project_id", scope);
  const { data, error } = await scoped.limit(5);
  if (error) throw new Error(error.message);
  const rows = data as Row[];
  const refs = await projectRefs(
    supabase,
    rows.map((r) => r.project_id).filter((id): id is string => id != null)
  );
  return rows.map((r) => ({
    id: r.id,
    category: "Inventory" as const,
    text: r.name,
    sub: r.project_id ? (refs.get(r.project_id)?.name ?? "") : "Central store",
    href: r.project_id ? sectionHref(refs.get(r.project_id), r.project_id, "/inventory") : "/inventory",
    projectId: r.project_id,
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
    projectId: null,
  }));
}
