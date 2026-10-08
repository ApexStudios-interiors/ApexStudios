"use server";

import "server-only";
import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction, clientAction, siteAction } from "@/lib/safe-action";
import { requireSession, requireRole, type Session } from "@/lib/auth/session";
import { presignGet } from "@/lib/r2/presign";
import { env } from "@/lib/env";
import {
  createBillSchema,
  recordPaymentSchema,
  rejectBillSchema,
  transitionBillSchema,
  uploadBillCopySchema,
} from "./schema";
import {
  getBillableNow,
  getBillDetail,
  getBillPaymentsSummary,
  getCurrentBillPdfKey,
  type BillableNowLine,
  type BillDetail,
} from "./queries";
import { transitionBillFor, type BillTransitionStatus } from "./transition";

/**
 * build/09-billing.md §4.4. `rpc_create_bill`, `rpc_transition_bill` and
 * `rpc_record_payment` enforce everything real (row locks, role,
 * membership, transition legality, the reason-required-to-reject rule, the
 * overpayment refusal) — these are guard, parse, delegate, revalidate,
 * nothing more (AGENTS.md's own layering rule).
 */

type BillRow = { id: string; project_id: string; status: string; bill_no: string; revision: number };

/**
 * build §4.8: "checked in the route layout and in every billing action."
 * The route side lives in the two billing pages (`notFound()` when off,
 * the same honest "this doesn't exist yet" framing a disabled route gets
 * elsewhere); this is the action side, so a hand-crafted call cannot bypass
 * the page never rendering the button in the first place.
 */
function assertBillingEnabled() {
  if (!env.BILLING_ENABLED) {
    throw new Error("FORBIDDEN: billing is not yet enabled for this project");
  }
}

export const createBill = adminAction.inputSchema(createBillSchema).action(async ({ parsedInput }) => {
  assertBillingEnabled();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_create_bill", {
    p_project_id: parsedInput.projectId,
    p_lines: parsedInput.lines.map((l) => ({ source_type: l.sourceType, source_id: l.sourceId })),
    p_bill_date: parsedInput.billDate,
    p_notes: parsedInput.notes,
    p_idempotency_key: parsedInput.idempotencyKey,
  });
  if (error) throw new Error(error.message);
  const row = data as { id: string; bill_no: string; project_id: string };

  updateTag(`project:${row.project_id}`);
  revalidatePath(`/projects/${row.project_id}`, "layout");
  return { id: row.id, refNo: row.bill_no };
});

/**
 * The admin-side transitions only: draft -> submitted/cancelled,
 * certified -> paid. `certifyBill`/`rejectBill` below are the client-side
 * transitions on this same RPC, each with their own role guard — splitting
 * them keeps every caller's own guard actually meaningful, rather than one
 * shared action whose input alone decides which role is allowed.
 * `rpc_transition_bill` itself is still the real enforcement either way
 * (an admin attempting submitted -> certified through this action would
 * still get the RPC's own FORBIDDEN, not a bypass).
 */
export const transitionBill = adminAction
  .inputSchema(transitionBillSchema)
  .action(async ({ parsedInput, ctx }) => transitionBillImpl(ctx.session, parsedInput));

export const certifyBill = clientAction
  .inputSchema(transitionBillSchema)
  .action(async ({ parsedInput, ctx }) => transitionBillImpl(ctx.session, parsedInput));

export const rejectBill = clientAction.inputSchema(rejectBillSchema).action(async ({ parsedInput, ctx }) => {
  return transitionBillImpl(ctx.session, {
    billId: parsedInput.billId,
    toStatus: "draft",
    note: parsedInput.reason,
  });
});

async function transitionBillImpl(
  session: Session,
  input: { billId: string; toStatus: BillTransitionStatus; note?: string }
) {
  assertBillingEnabled();
  // The RPC call (and the PDF enqueue on submit) lives in ./transition.ts,
  // shared with the mobile API so both write paths behave identically.
  const moved = await transitionBillFor(session, input);

  updateTag(`project:${moved.projectId}`);
  revalidatePath(`/projects/${moved.projectId}`, "layout");
  return { id: moved.id, status: moved.status };
}

export const recordPayment = adminAction.inputSchema(recordPaymentSchema).action(async ({ parsedInput }) => {
  assertBillingEnabled();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_record_payment", {
    p_bill_id: parsedInput.billId,
    p_amount: parsedInput.amount,
    p_paid_on: parsedInput.paidOn,
    p_mode: parsedInput.mode,
    p_reference_no: parsedInput.referenceNo,
    p_idempotency_key: parsedInput.idempotencyKey,
  });
  if (error) throw new Error(error.message);
  const row = data as BillRow;

  updateTag(`project:${row.project_id}`);
  revalidatePath(`/projects/${row.project_id}`, "layout");
  return { id: row.id, status: row.status };
});

/**
 * `02-lld.md §7`: admin AND site may upload a bill copy (a scanned physical
 * invoice/challan, not the system-generated PDF) — wider than the rest of
 * this file, which is why it uses `siteAction`, not `adminAction`.
 */
export const uploadBillCopy = siteAction
  .inputSchema(uploadBillCopySchema)
  .action(async ({ parsedInput, ctx }) => {
    assertBillingEnabled();
    const supabase = await createClient();
    const { data: bill, error: billErr } = await supabase
      .from("bills")
      .select("id, project_id")
      .eq("id", parsedInput.billId)
      .is("deleted_at", null)
      .maybeSingle();
    if (billErr) throw new Error(billErr.message);
    if (!bill) throw new Error("NOT_FOUND: this bill no longer exists");

    const { data: owned, error: attErr } = await supabase
      .from("attachments")
      .select("id")
      .in("id", parsedInput.attachmentIds)
      .eq("entity_type", "bill")
      .eq("entity_id", parsedInput.billId)
      .eq("project_id", bill.project_id)
      .eq("uploaded_by", ctx.session.userId)
      .is("deleted_at", null);
    if (attErr) throw new Error(attErr.message);
    if ((owned?.length ?? 0) !== parsedInput.attachmentIds.length) {
      throw new Error("NOT_FOUND: one or more files did not upload correctly — please retry them");
    }

    updateTag(`project:${bill.project_id}`);
    revalidatePath(`/projects/${bill.project_id}`, "layout");
    return { id: bill.id };
  });

/**
 * `getDownloadUrl`'s own bill-PDF-specific wrapper — "pdf: any member," per
 * `02-lld.md §7`, unlike everything else in this file. The PDF itself is
 * generated once by the `bill.pdf` job on submit and stored as a normal
 * `attachments` row (entity_type='bill'); this looks that row up rather
 * than rendering anything itself. Excel export is deliberately NOT here —
 * build §4.7's own "streamed directly from a route handler on request, not
 * a job" means the Download Excel button hits
 * `/api/bills/[billId]/export.xlsx` directly, admin-only, checked in the
 * route handler itself.
 */
export async function getBillPdfUrl(billId: string): Promise<string | null> {
  assertBillingEnabled();
  const session = await requireSession();
  // Which attachment is the invoice — the one generated for the bill's
  // current revision, never an uploaded copy or a superseded revision — is
  // decided in getCurrentBillPdfKey (./queries.ts).
  const key = await getCurrentBillPdfKey(session, billId);
  if (!key) return null;
  return presignGet(key, "attachment");
}

/** `BillingAdmin`'s own Billable Now fetch — `queries.ts` is `server-only`
 *  and a component may never import it directly (code-standards §1); this
 *  file's `"use server"` directive is what makes it reachable from a
 *  client component. */
export async function getBillableNowForAdmin(projectId: string): Promise<BillableNowLine[]> {
  assertBillingEnabled();
  return getBillableNow(projectId);
}

/** `BillViewDialog`'s own data fetch — a client component calling a `"use
 *  server"` export directly, same as `getPackageOptions`/`getPhaseOptions`
 *  elsewhere: `queries.ts` itself is `server-only` and cannot be imported
 *  into a client bundle, this file's own `"use server"` directive is what
 *  makes it reachable.
 *
 *  `requireRole`, not `requireSession`: `getBillDetail`'s own non-admin
 *  branch reads `v_bill_client`/`v_bill_line_client`, which are gated only
 *  by project membership, not role (Build 07's own views, built ahead of
 *  need). Site is a project member but must see no money at all (AGENTS.md's
 *  own rule) — `viewBilling` (`lib/rbac/permissions.ts`) is the real
 *  membership list this action is allowed to serve, and site is
 *  deliberately not on it. A plain `requireSession` here would let a site
 *  session reach the client-shaped branch directly, bypassing both the
 *  billing page's own `forbidden()` for site and the "any non-admin ==
 *  client" assumption `getBillDetail` itself makes. */
export async function getBillDetailForDialog(billId: string): Promise<BillDetail | null> {
  assertBillingEnabled();
  const session = await requireRole(["admin", "client"]);
  return getBillDetail(session, billId);
}

/** `RecordPaymentDialog`'s own "already paid X, Y remaining" fetch. */
export async function getBillPaymentsSummaryForDialog(billId: string) {
  assertBillingEnabled();
  return getBillPaymentsSummary(billId);
}

/**
 * `rpc_mark_phase_complete`'s own Server Action wiring (migration
 * 20260911090001's own comment: "its Server Action and UI wiring land in
 * Build 09 with the rest of the Billing tab conversion"). Admin only, and
 * only for a zero-task phase — the RPC itself enforces both; this is guard,
 * parse, delegate, revalidate.
 */
/**
 * Marks EVERY phase of one package that is eligible, in one action.
 *
 * Why this exists: testing found an owner marking a PACKAGE "completed" and
 * then looking for it in Create Bill. Billing never reads `packages.status` —
 * it reads phases (all tasks at 100%, or `manual_complete_at` set) and
 * delivered materials. So a package can read "completed" on every screen while
 * nothing about it is billable, which is the confusion this closes. A package
 * of 14 phases otherwise needs 14 separate clicks to reach the same place.
 *
 * It is a loop over the SAME `rpc_mark_phase_complete`, not a new rule: each
 * phase keeps its own guard (admin only, zero tasks, not already billed) and
 * writes its own audit row with a name against it. Nothing here can mark a
 * phase the single-phase button could not.
 *
 * Failures are counted, not thrown. A phase that became ineligible between the
 * page render and the click (someone else billed it, a task was added) must not
 * abandon the other thirteen — the result reports what actually happened so the
 * UI can say so.
 */
export const markPackagePhasesComplete = adminAction
  .inputSchema(z.object({ packageId: z.uuid() }))
  .action(async ({ parsedInput }) => {
    assertBillingEnabled();
    const supabase = await createClient();

    // Re-read eligibility server-side rather than trusting a list of ids from
    // the client: the page may be minutes stale, and this decides billability.
    const { data: phases, error } = await supabase
      .from("v_phase_billing")
      .select("phase_id, project_id, task_count, is_complete, billing_status")
      .eq("package_id", parsedInput.packageId);
    if (error) throw new Error(error.message);

    const eligible = phases.filter(
      (p) =>
        p.task_count === 0 &&
        !p.is_complete &&
        (p.billing_status === "unresolved" || p.billing_status === "billable")
    );

    let marked = 0;
    let failed = 0;
    for (const phase of eligible) {
      if (!phase.phase_id) continue;
      const { error: rpcErr } = await supabase.rpc("rpc_mark_phase_complete", {
        p_phase_id: phase.phase_id,
      });
      if (rpcErr) failed++;
      else marked++;
    }

    const projectId = phases[0]?.project_id;
    if (projectId) {
      updateTag(`project:${projectId}`);
      revalidatePath(`/projects/${projectId}`, "layout");
    }
    return { marked, failed, eligible: eligible.length };
  });

export const markPhaseComplete = adminAction
  .inputSchema(z.object({ phaseId: z.uuid() }))
  .action(async ({ parsedInput }) => {
    assertBillingEnabled();
    const supabase = await createClient();
    const { error } = await supabase.rpc("rpc_mark_phase_complete", { p_phase_id: parsedInput.phaseId });
    if (error) throw new Error(error.message);

    const { data: phase, error: phaseErr } = await supabase
      .from("phases")
      .select("project_id")
      .eq("id", parsedInput.phaseId)
      .single();
    if (phaseErr) throw new Error(phaseErr.message);

    updateTag(`project:${phase.project_id}`);
    revalidatePath(`/projects/${phase.project_id}`, "layout");
    return { id: parsedInput.phaseId };
  });
