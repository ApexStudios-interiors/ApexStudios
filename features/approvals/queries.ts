import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireSession, type Session } from "@/lib/auth/session";
import { fetchPage, type Page, type PageRequest } from "@/lib/pagination";
import { presignGet } from "@/lib/r2/presign";
import { canAddPhotos, canDecide, canSupersede } from "./service";
import type { ApprovalType } from "./schema";

/**
 * build/08-approvals.md §2.4: "approvals are visible to all three roles
 * (01-hld.md §7.1), so the shape is the same for everyone; there are no cost
 * columns on the table." No role ternary on the approval row itself — only
 * on the package/phase NAME lookups, which stay admin-only base tables
 * (`packages`/`phases`) the same way `features/updates/queries.ts` and
 * `features/schedule/queries.ts` already handle it.
 */

export type ApprovalAttachment = {
  id: string;
  isImage: boolean;
  thumbUrl: string | null;
  downloadUrl: string;
};

export type ApprovalDTO = {
  id: string;
  refNo: string;
  packageId: string;
  packageName: string | null;
  packageSeqNo: number | null;
  phaseId: string | null;
  phaseName: string | null;
  type: ApprovalType;
  item: string;
  note: string | null;
  neededBy: string | null;
  status: "pending" | "approved" | "rejected";
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  decidedById: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  // build §2.3: "the detail view of a superseding approval links back to
  // what it replaced, and the superseded one links forward" — both
  // directions, so neither side of a revision history reads as a dead end.
  supersedesId: string | null;
  supersedesRefNo: string | null;
  supersededById: string | null;
  supersededByRefNo: string | null;
  canAddPhotos: boolean;
  canDecide: boolean;
  canSupersede: boolean;
  attachments: ApprovalAttachment[];
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

async function fetchPhaseNames(isAdmin: boolean, projectId: string): Promise<Map<string, string>> {
  const supabase = await createClient();
  if (isAdmin) {
    const { data, error } = await supabase
      .from("phases")
      .select("id, name")
      .eq("project_id", projectId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return new Map(data.map((p) => [p.id, p.name]));
  }
  const { data, error } = await supabase.from("v_phase_site").select("id, name").eq("project_id", projectId);
  if (error) throw new Error(error.message);
  return new Map(
    data
      .filter((p): p is { id: string; name: string } => p.id != null && p.name != null)
      .map((p) => [p.id, p.name])
  );
}

async function fetchProfileNames(profileIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(profileIds.filter((id): id is string => id != null))];
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return new Map(data.map((p) => [p.id, p.full_name]));
}

type AttachmentRow = {
  id: string;
  entity_id: string;
  mime_type: string;
  r2_key: string;
  thumb_r2_key: string | null;
};

/** build §2.2/migration 0036's own freeze policies gate INSERT/DELETE, not
 *  SELECT — a decided approval's existing photos stay visible, just frozen. */
async function fetchAttachments(approvalIds: string[]): Promise<AttachmentRow[]> {
  if (approvalIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attachments")
    .select("id, entity_id, mime_type, r2_key, thumb_r2_key")
    .eq("entity_type", "approval")
    .in("entity_id", approvalIds)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return data;
}

type ApprovalRow = {
  id: string;
  ref_no: string;
  package_id: string;
  phase_id: string | null;
  type: ApprovalType;
  item: string;
  note: string | null;
  needed_by: string | null;
  status: "pending" | "approved" | "rejected";
  requested_by: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  supersedes_id: string | null;
  created_at: string;
};

type ApprovalFilter = { status?: "pending" | "approved" | "rejected" };

/** The list query, ready to page: `id` breaks ties between equal
 *  `created_at`s so no row lands on two pages or on none. */
function approvalsQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  opts: ApprovalFilter,
  counted: boolean
) {
  let query = supabase
    .from("approvals")
    .select(
      "id, ref_no, package_id, phase_id, type, item, note, needed_by, status, requested_by, decided_by, decided_at, decision_reason, supersedes_id, created_at",
      { count: counted ? "exact" : undefined }
    )
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (opts.status) query = query.eq("status", opts.status);
  return query;
}

export async function getApprovalsForProject(
  session: Session,
  projectId: string,
  opts: ApprovalFilter = {}
): Promise<ApprovalDTO[]> {
  const supabase = await createClient();
  const { data: rows, error } = await approvalsQuery(supabase, projectId, opts, false);
  if (error) throw new Error(error.message);
  return toApprovalDTOs(session, projectId, rows as ApprovalRow[]);
}

/**
 * The Approvals table: one page of the same rows, filtered and paginated in
 * the query itself (`count: "exact"` + `.range()`, lib/pagination.ts) — the
 * attachments, package/phase names and supersede links are then resolved for
 * that page only, which is also what keeps those follow-up queries small.
 */
export async function getApprovalsPage(
  session: Session,
  projectId: string,
  opts: ApprovalFilter,
  req: PageRequest
): Promise<Page<ApprovalDTO>> {
  const supabase = await createClient();
  const page = await fetchPage(
    (from, to) => approvalsQuery(supabase, projectId, opts, true).range(from, to),
    req
  );
  return { ...page, rows: await toApprovalDTOs(session, projectId, page.rows as ApprovalRow[]) };
}

async function toApprovalDTOs(
  session: Session,
  projectId: string,
  typedRows: ApprovalRow[]
): Promise<ApprovalDTO[]> {
  const supabase = await createClient();
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";

  const ids = typedRows.map((r) => r.id);
  const supersedesIds = typedRows.map((r) => r.supersedes_id);

  // The forward link (what superseded THIS row, if anything) has no column
  // to read off — it is the reverse of another row's `supersedes_id` — so it
  // is a second query keyed on this page's own ids, same shape as the
  // backward link is keyed on `supersedes_id`.
  const [packageNames, phaseNames, profileNames, attachmentRows, supersededByRows] = await Promise.all([
    fetchPackageNames(isAdmin, projectId),
    fetchPhaseNames(isAdmin, projectId),
    fetchProfileNames([...typedRows.map((r) => r.requested_by), ...typedRows.map((r) => r.decided_by)]),
    fetchAttachments(ids),
    ids.length > 0
      ? supabase
          .from("approvals")
          .select("id, ref_no, supersedes_id")
          .in("supersedes_id", ids)
          .is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (supersededByRows.error) throw new Error(supersededByRows.error.message);

  const refNoById = new Map(typedRows.map((r) => [r.id, r.ref_no]));
  // A superseded target might not be on this page (a different status
  // filter, or paged differently) — look it up separately rather than
  // assuming it is one of `typedRows`.
  const missingSupersedeIds = [
    ...new Set(supersedesIds.filter((id): id is string => id != null && !refNoById.has(id))),
  ];
  if (missingSupersedeIds.length > 0) {
    const { data: extra, error: extraErr } = await supabase
      .from("approvals")
      .select("id, ref_no")
      .in("id", missingSupersedeIds)
      .is("deleted_at", null);
    if (extraErr) throw new Error(extraErr.message);
    for (const e of extra) refNoById.set(e.id, e.ref_no);
  }

  const supersededByRefNoBySupersedesId = new Map(
    (supersededByRows.data as { id: string; ref_no: string; supersedes_id: string | null }[]).map((r) => [
      r.supersedes_id,
      { id: r.id, refNo: r.ref_no },
    ])
  );

  const attachmentDtosByApproval = new Map<string, ApprovalAttachment[]>();
  for (const a of attachmentRows) {
    const isImage = a.mime_type.startsWith("image/");
    const objectPath = a.thumb_r2_key ?? a.r2_key;
    const thumbUrl = isImage ? await presignGet(objectPath) : null;
    const downloadUrl = await presignGet(a.r2_key, isImage ? undefined : "attachment");
    const list = attachmentDtosByApproval.get(a.entity_id) ?? [];
    list.push({ id: a.id, isImage, thumbUrl, downloadUrl });
    attachmentDtosByApproval.set(a.entity_id, list);
  }

  return typedRows.map((r) => {
    const supersededBy = supersededByRefNoBySupersedesId.get(r.id) ?? null;
    return {
      id: r.id,
      refNo: r.ref_no,
      packageId: r.package_id,
      packageName: packageNames.get(r.package_id)?.name ?? null,
      packageSeqNo: packageNames.get(r.package_id)?.seqNo ?? null,
      phaseId: r.phase_id,
      phaseName: r.phase_id ? (phaseNames.get(r.phase_id) ?? null) : null,
      type: r.type,
      item: r.item,
      note: r.note,
      neededBy: r.needed_by,
      status: r.status,
      requestedById: r.requested_by,
      requestedByName: profileNames.get(r.requested_by) ?? "—",
      requestedAt: r.created_at,
      decidedById: r.decided_by,
      decidedByName: r.decided_by ? (profileNames.get(r.decided_by) ?? "—") : null,
      decidedAt: r.decided_at,
      decisionReason: r.decision_reason,
      supersedesId: r.supersedes_id,
      supersedesRefNo: r.supersedes_id ? (refNoById.get(r.supersedes_id) ?? null) : null,
      supersededById: supersededBy?.id ?? null,
      supersededByRefNo: supersededBy?.refNo ?? null,
      canAddPhotos: canAddPhotos(r.status),
      canDecide: canDecide(r.status),
      canSupersede: canSupersede(r.status),
      attachments: attachmentDtosByApproval.get(r.id) ?? [],
    };
  });
}

/**
 * architecture.md §9.1's "Approvals pending > 7 days" telemetry figure for
 * Build 10's Admin dashboard — computed here, surfaced there (build §2.4's
 * own instruction). RLS's `ap_select` policy (membership, not admin-gated)
 * scopes this to whatever the caller's session can already see: for an
 * owner/admin session that is every project in the org, which is exactly
 * what an Admin dashboard figure should count.
 */
export async function getAgedApprovalsCount(): Promise<number> {
  await requireSession();
  const supabase = await createClient();
  const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("approvals")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("created_at", threshold)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
