import "server-only";
import type { Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { RequestApprovalInput } from "./schema";

/**
 * Raising an approval, once, for every caller — the web's `requestApproval`
 * action (./actions.ts) and the mobile API. Both authenticate, check the role
 * (admin/site) and validate (requestApprovalSchema) first; this re-checks any
 * sample photos and calls `rpc_create_approval`, which enforces everything
 * real: membership, role, the item, the ref number under a row lock, the
 * audit — and supersession (build §2.3): the approval it revises must exist
 * in this project (else NOT_FOUND), be rejected, and not have been revised
 * already (else ILLEGAL_TRANSITION).
 *
 * Errors are thrown as `Error(message)` exactly as before, so each caller's
 * mapDomainError applies unchanged. No caching or revalidation here — that is
 * the web action's concern.
 */
export async function requestApprovalFor(
  session: Session,
  input: RequestApprovalInput
): Promise<{ id: string; refNo: string; projectId: string; status: "pending" | "approved" | "rejected" }> {
  const { id, projectId, packageId, phaseId, type, item, note, neededBy, attachmentIds, supersedesId } =
    input;
  const supabase = await createClient();

  // The re-check `postDailyUpdate` (features/updates/actions.ts) already
  // established: `FileUploader`'s uploads are confirmed BEFORE this ever
  // runs, tagged with this dialog's own client-generated id — confirm each
  // one really is one of this session's own uploads for this exact
  // project and (not-yet-existing) approval, not a stray id.
  if (attachmentIds.length > 0) {
    const { data: owned, error: attErr } = await supabase
      .from("attachments")
      .select("id")
      .in("id", attachmentIds)
      .eq("entity_type", "approval")
      .eq("entity_id", id)
      .eq("project_id", projectId)
      .eq("uploaded_by", session.userId)
      .is("deleted_at", null);
    if (attErr) throw new Error(attErr.message);
    if ((owned?.length ?? 0) !== attachmentIds.length) {
      throw new Error("NOT_FOUND: one or more photos did not upload correctly — please retry them");
    }
  }

  const { data, error } = await supabase.rpc("rpc_create_approval", {
    p_id: id,
    p_project_id: projectId,
    p_package_id: packageId,
    p_type: type,
    p_item: item,
    p_phase_id: phaseId,
    p_note: note,
    p_needed_by: neededBy,
    p_supersedes_id: supersedesId,
  });
  // The id is the caller's (schema.ts) — chosen once by the web dialog and by
  // the mobile form — so a retry of a request that already succeeded (a lost
  // response, a second tap) meets approvals_pkey inside the RPC, which rolls
  // the whole call back (its ref number too). That is "already requested",
  // not an unexpected failure: the domain ILLEGAL_TRANSITION (409 on mobile),
  // never a second approval. Same as postDailyUpdateFor's daily_updates_pkey.
  if (error?.code === "23505" && error.message.includes("approvals_pkey")) {
    throw new Error("ILLEGAL_TRANSITION: this approval has already been requested");
  }
  if (error) throw new Error(error.message);
  // The generated type for a `returns public.approvals` RPC is `unknown`
  // (scripts/gen-types.mjs only maps scalar Postgres types) — same cast
  // `createStockRequestFor` needs for its own composite-row RPC. Only these
  // columns are read.
  const row = data as {
    id: string;
    ref_no: string;
    project_id: string;
    status: "pending" | "approved" | "rejected";
  };
  return { id: row.id, refNo: row.ref_no, projectId: row.project_id, status: row.status };
}
