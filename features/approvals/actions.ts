"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { siteAction, clientAction } from "@/lib/safe-action";
import { requireSession } from "@/lib/auth/session";
import { canAddPhotos } from "./service";
import { addSamplePhotosSchema, decideApprovalSchema, requestApprovalSchema } from "./schema";

/**
 * build/08-approvals.md §2.4. `rpc_create_approval` and `rpc_decide_approval`
 * enforce everything real (row locks, role, membership, transition legality,
 * the reason-required-to-reject rule) — these are guard, parse, delegate,
 * revalidate, nothing more (AGENTS.md's own layering rule).
 */

export const requestApproval = siteAction
  .inputSchema(requestApprovalSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { id, projectId, packageId, phaseId, type, item, note, neededBy, attachmentIds, supersedesId } =
      parsedInput;
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
        .eq("uploaded_by", ctx.session.userId)
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
    if (error) throw new Error(error.message);
    // The generated type for a `returns public.approvals` RPC is `unknown`
    // (scripts/gen-types.mjs only maps scalar Postgres types) — same cast
    // `createStockRequest` already needed for its own composite-row RPC.
    const row = data as { id: string; ref_no: string };

    updateTag(`project:${projectId}`);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { id: row.id, refNo: row.ref_no };
  });

/**
 * build §2.1's own guardrail: "addSamplePhotos refuses when status <>
 * 'pending'." The RLS freeze (migration 0036/0037) is the layer that holds
 * when this one is wrong — this check exists to give a clean error instead
 * of a raw Postgres RLS-violation message reaching the form.
 */
export const addSamplePhotos = siteAction
  .inputSchema(addSamplePhotosSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { approvalId, attachmentIds } = parsedInput;
    const supabase = await createClient();

    const { data: approval, error: apErr } = await supabase
      .from("approvals")
      .select("id, project_id, status")
      .eq("id", approvalId)
      .is("deleted_at", null)
      .maybeSingle();
    if (apErr) throw new Error(apErr.message);
    // ap_select's own membership scoping simply excludes a row this session
    // cannot see, rather than raising — a clean error here, same as
    // `editDailyUpdate`'s own not-found-after-update handling.
    if (!approval) throw new Error("NOT_FOUND: this approval no longer exists");
    if (!canAddPhotos(approval.status)) {
      throw new Error("ILLEGAL_TRANSITION: photos can only be added to a pending approval");
    }

    const { data: owned, error: attErr } = await supabase
      .from("attachments")
      .select("id")
      .in("id", attachmentIds)
      .eq("entity_type", "approval")
      .eq("entity_id", approvalId)
      .eq("project_id", approval.project_id)
      .eq("uploaded_by", ctx.session.userId)
      .is("deleted_at", null);
    if (attErr) throw new Error(attErr.message);
    if ((owned?.length ?? 0) !== attachmentIds.length) {
      throw new Error("NOT_FOUND: one or more photos did not upload correctly — please retry them");
    }

    updateTag(`project:${approval.project_id}`);
    revalidatePath(`/projects/${approval.project_id}`, "layout");
    return { id: approval.id };
  });

/**
 * Client only. `rpc_decide_approval` enforces it (`FORBIDDEN: only a client
 * may decide an approval`) — `clientAction`'s own role guard gives a clean
 * error before the round trip even happens, same reason `certifyBill` will
 * pair a role-guarded action with its own RPC check (build §5's shared rule:
 * "don't add an Admin bypass, including for testing").
 */
export const decideApproval = clientAction.inputSchema(decideApprovalSchema).action(async ({ parsedInput }) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_decide_approval", {
    p_approval_id: parsedInput.approvalId,
    p_decision: parsedInput.decision,
    p_reason: parsedInput.reason,
  });
  if (error) throw new Error(error.message);
  const row = data as { id: string; project_id: string; status: string };

  updateTag(`project:${row.project_id}`);
  revalidatePath(`/projects/${row.project_id}`, "layout");
  return { id: row.id, status: row.status };
});

/** `NewApprovalDialog`'s Package field — `v_package_site`, same reason
 *  `features/updates/actions.ts`/`features/stock/actions.ts` each read it
 *  directly rather than `packages`: the dialog is open to site too, and a
 *  package name carries no money. */
export async function getPackageOptions(projectId: string): Promise<{ id: string; name: string }[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_package_site")
    .select("id, name, seq_no")
    .eq("project_id", projectId)
    .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);
  return data
    .filter((p): p is { id: string; name: string; seq_no: number } => p.id != null && p.name != null)
    .map((p) => ({ id: p.id, name: p.name }));
}

/** `NewApprovalDialog`'s Phase field (optional) — `v_phase_site`, same
 *  reason as `features/schedule/actions.ts`'s own `getPhaseOptions`. */
export async function getPhaseOptions(packageId: string): Promise<{ id: string; name: string }[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_phase_site")
    .select("id, name, seq_no")
    .eq("package_id", packageId)
    .order("seq_no", { ascending: true });
  if (error) throw new Error(error.message);
  return data
    .filter((p): p is { id: string; name: string; seq_no: number } => p.id != null && p.name != null)
    .map((p) => ({ id: p.id, name: p.name }));
}
