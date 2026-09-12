"use server";

import "server-only";
import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction, clientAction, siteAction } from "@/lib/safe-action";
import { requireSession } from "@/lib/auth/session";
import { enqueue } from "@/lib/jobs/enqueue";
import { presignGet } from "@/lib/r2/presign";
import { env } from "@/lib/env";
import {
  createBillSchema,
  recordPaymentSchema,
  rejectBillSchema,
  transitionBillSchema,
  uploadBillCopySchema,
} from "./schema";
import { getBillableNow, getBillDetail, getBillPaymentsSummary, type BillableNowLine, type BillDetail } from "./queries";

/**
 * build/09-billing.md §4.4. `rpc_create_bill`, `rpc_transition_bill` and
 * `rpc_record_payment` enforce everything real (row locks, role,
 * membership, transition legality, the reason-required-to-reject rule, the
 * overpayment refusal) — these are guard, parse, delegate, revalidate,
 * nothing more (AGENTS.md's own layering rule).
 */

type BillRow = { id: string; project_id: string; status: string; bill_no: string };

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
  .action(async ({ parsedInput }) => transitionBillImpl(parsedInput));

export const certifyBill = clientAction
  .inputSchema(transitionBillSchema)
  .action(async ({ parsedInput }) => transitionBillImpl(parsedInput));

export const rejectBill = clientAction.inputSchema(rejectBillSchema).action(async ({ parsedInput }) => {
  return transitionBillImpl({ billId: parsedInput.billId, toStatus: "draft", note: parsedInput.reason });
});

type BillTransitionStatus = "submitted" | "cancelled" | "certified" | "draft" | "paid";

async function transitionBillImpl(input: { billId: string; toStatus: BillTransitionStatus; note?: string }) {
  assertBillingEnabled();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_transition_bill", {
    p_bill_id: input.billId,
    p_to_status: input.toStatus,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  const row = data as BillRow;

  // draft -> submitted enqueues the PDF render, same place confirmUpload
  // enqueues attachment.thumbnail (application layer, not inside the RPC —
  // a security definer function has no session to enqueue as).
  if (row.status === "submitted") {
    await enqueue("bill.pdf", { billId: row.id }, { idempotencyKey: `${row.id}:${row.status}` });
  }

  updateTag(`project:${row.project_id}`);
  revalidatePath(`/projects/${row.project_id}`, "layout");
  return { id: row.id, status: row.status };
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
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attachments")
    .select("r2_key")
    .eq("entity_type", "bill")
    .eq("entity_id", billId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return presignGet(data.r2_key, "attachment");
}

/** `BillingAdmin`'s own Billable Now fetch — `queries.ts` is `server-only`
 *  and a component may never import it directly (code-standards §1); this
 *  file's `"use server"` directive is what makes it reachable from a
 *  client component. */
export async function getBillableNowForAdmin(projectId: string): Promise<BillableNowLine[]> {
  return getBillableNow(projectId);
}

/** `BillViewDialog`'s own data fetch — a client component calling a `"use
 *  server"` export directly, same as `getPackageOptions`/`getPhaseOptions`
 *  elsewhere: `queries.ts` itself is `server-only` and cannot be imported
 *  into a client bundle, this file's own `"use server"` directive is what
 *  makes it reachable. */
export async function getBillDetailForDialog(billId: string): Promise<BillDetail | null> {
  const session = await requireSession();
  return getBillDetail(session, billId);
}

/** `RecordPaymentDialog`'s own "already paid X, Y remaining" fetch. */
export async function getBillPaymentsSummaryForDialog(billId: string) {
  return getBillPaymentsSummary(billId);
}

/**
 * `rpc_mark_phase_complete`'s own Server Action wiring (migration
 * 20260911090001's own comment: "its Server Action and UI wiring land in
 * Build 09 with the rest of the Billing tab conversion"). Admin only, and
 * only for a zero-task phase — the RPC itself enforces both; this is guard,
 * parse, delegate, revalidate.
 */
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
