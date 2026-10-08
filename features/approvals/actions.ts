"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { siteAction, clientAction } from "@/lib/safe-action";
import { requireSession } from "@/lib/auth/session";
import { addSamplePhotosSchema, decideApprovalSchema, requestApprovalSchema } from "./schema";
import { requestApprovalFor } from "./create";
import { approvalForPhotos } from "./photos";

/**
 * build/08-approvals.md §2.4. `rpc_create_approval` and `rpc_decide_approval`
 * enforce everything real (row locks, role, membership, transition legality,
 * the reason-required-to-reject rule) — these are guard, parse, delegate,
 * revalidate, nothing more (AGENTS.md's own layering rule).
 */

export const requestApproval = siteAction
  .inputSchema(requestApprovalSchema)
  .action(async ({ parsedInput, ctx }) => {
    // The photo re-check and the RPC call live in ./create.ts, shared with
    // the mobile API so both write paths behave identically.
    const created = await requestApprovalFor(ctx.session, parsedInput);

    updateTag(`project:${parsedInput.projectId}`);
    revalidatePath(`/projects/${parsedInput.projectId}`, "layout");
    return { id: created.id, refNo: created.refNo };
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
    // Exists for this session and still pending — shared with the mobile
    // photo routes (./photos.ts).
    const approval = await approvalForPhotos(approvalId);
    const supabase = await createClient();

    const { data: owned, error: attErr } = await supabase
      .from("attachments")
      .select("id")
      .in("id", attachmentIds)
      .eq("entity_type", "approval")
      .eq("entity_id", approvalId)
      .eq("project_id", approval.projectId)
      .eq("uploaded_by", ctx.session.userId)
      .is("deleted_at", null);
    if (attErr) throw new Error(attErr.message);
    if ((owned?.length ?? 0) !== attachmentIds.length) {
      throw new Error("NOT_FOUND: one or more photos did not upload correctly — please retry them");
    }

    updateTag(`project:${approval.projectId}`);
    revalidatePath(`/projects/${approval.projectId}`, "layout");
    return { id: approval.id };
  });

/**
 * Client only. `rpc_decide_approval` enforces it (`FORBIDDEN: only a client
 * may decide an approval`) — `clientAction`'s own role guard gives a clean
 * error before the round trip even happens, same reason `certifyBill` will
 * pair a role-guarded action with its own RPC check (build §5's shared rule:
 * "don't add an Admin bypass, including for testing").
 */
export const decideApproval = clientAction
  .inputSchema(decideApprovalSchema)
  .action(async ({ parsedInput }) => {
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
