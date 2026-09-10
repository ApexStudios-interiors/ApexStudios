import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import { presignGet } from "@/lib/r2/presign";
import { canEditUpdate } from "./service";

/**
 * `daily_updates` carries no money (same as `tasks`, Build 05's own
 * comment), so the update rows themselves need no role ternary. Package
 * NAMES still do: `packages` is an admin-only base table, and Build 04/05
 * both found the same bug live — an incidental lookup against it from a
 * non-admin code path silently returns nothing under RLS. `v_package_site`
 * for non-admin, same pattern as `features/schedule/queries.ts`.
 */

export type UpdateAttachment = { id: string; isImage: boolean; thumbUrl: string | null; downloadUrl: string };

export type UpdateDTO = {
  id: string;
  packageId: string;
  packageName: string | null;
  packageSeqNo: number | null;
  updateDate: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  canEdit: boolean;
  attachments: UpdateAttachment[];
};

export type UpdatesPage = { items: UpdateDTO[]; nextCursor: string | null };

const PAGE_SIZE = 20;

type Cursor = { updateDate: string; createdAt: string; id: string };

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      "updateDate" in parsed &&
      "createdAt" in parsed &&
      "id" in parsed &&
      typeof parsed.updateDate === "string" &&
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string"
    ) {
      return { updateDate: parsed.updateDate, createdAt: parsed.createdAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

type PackageInfo = { name: string; seqNo: number };

/** `mno()`'s own "01 Swimming Pool" convention (lib/logic.ts) — the
 *  prototype's UpdateList always prefixed the badge with the package
 *  number; dropping it was a real, avoidable visual diff caught by the
 *  proto-v1 baseline. */
async function fetchPackageNames(isAdmin: boolean, projectId: string): Promise<Map<string, PackageInfo>> {
  const supabase = await createClient();
  if (isAdmin) {
    const { data, error } = await supabase
      .from("packages")
      .select("id, name, seq_no")
      .eq("project_id", projectId);
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
  const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", profileIds);
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

async function fetchAttachments(updateIds: string[]): Promise<AttachmentRow[]> {
  if (updateIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attachments")
    .select("id, entity_id, mime_type, r2_key, thumb_r2_key")
    .eq("entity_type", "daily_update")
    .in("entity_id", updateIds)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return data;
}

export async function getUpdatesForProject(
  session: Session,
  projectId: string,
  opts: { packageId?: string; cursor?: string } = {}
): Promise<UpdatesPage> {
  const supabase = await createClient();
  const effectiveRole = session.impersonating?.role ?? session.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin";

  let query = supabase
    .from("daily_updates")
    .select("id, package_id, update_date, body, author_id, created_at")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("update_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (opts.packageId) query = query.eq("package_id", opts.packageId);

  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (cursor) {
    // Keyset pagination over a 3-column tiebreak, expressed as PostgREST's
    // own `or` of three mutually exclusive "strictly before" conditions —
    // its filter builder has no row-value (a, b, c) < (x, y, z) comparison.
    query = query.or(
      [
        `update_date.lt.${cursor.updateDate}`,
        `and(update_date.eq.${cursor.updateDate},created_at.lt.${cursor.createdAt})`,
        `and(update_date.eq.${cursor.updateDate},created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      ].join(",")
    );
  }

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  const authorIds = [...new Set(pageRows.map((r) => r.author_id))];
  const updateIds = pageRows.map((r) => r.id);

  const [packageNames, authorNames, attachmentRows] = await Promise.all([
    fetchPackageNames(isAdmin, projectId),
    fetchProfileNames(authorIds),
    fetchAttachments(updateIds),
  ]);

  const attachmentDtosByUpdate = new Map<string, UpdateAttachment[]>();
  for (const a of attachmentRows) {
    const isImage = a.mime_type.startsWith("image/");
    const objectPath = a.thumb_r2_key ?? a.r2_key;
    // getSignedUrl computes the signature locally (no network round trip) —
    // presigning per attachment on a paginated list is cheap, sequential or not.
    const thumbUrl = isImage ? await presignGet(objectPath) : null;
    const downloadUrl = await presignGet(a.r2_key, isImage ? undefined : "attachment");
    const list = attachmentDtosByUpdate.get(a.entity_id) ?? [];
    list.push({ id: a.id, isImage, thumbUrl, downloadUrl });
    attachmentDtosByUpdate.set(a.entity_id, list);
  }

  const now = new Date();
  const items: UpdateDTO[] = pageRows.map((r) => ({
    id: r.id,
    packageId: r.package_id,
    packageName: packageNames.get(r.package_id)?.name ?? null,
    packageSeqNo: packageNames.get(r.package_id)?.seqNo ?? null,
    updateDate: r.update_date,
    body: r.body,
    authorId: r.author_id,
    authorName: authorNames.get(r.author_id) ?? "—",
    createdAt: r.created_at,
    canEdit: canEditUpdate({ authorId: r.author_id, createdAt: r.created_at }, session.userId, now),
    attachments: attachmentDtosByUpdate.get(r.id) ?? [],
  }));

  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ updateDate: last.update_date, createdAt: last.created_at, id: last.id })
      : null;

  return { items, nextCursor };
}
