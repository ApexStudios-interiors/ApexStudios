import "server-only";
import type { Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { enqueue } from "@/lib/jobs/enqueue";
import { billPdfJobKey } from "./pdf";

export type BillTransitionStatus = "submitted" | "cancelled" | "certified" | "draft" | "paid";

type BillRow = { id: string; project_id: string; status: string; bill_no: string; revision: number };

/**
 * Moving a bill along its workflow, once, for every caller — the web's
 * `transitionBill`/`certifyBill`/`rejectBill` actions (./actions.ts) and the
 * mobile API. Each caller authenticates, checks the role, validates (the
 * actions' own schemas) and checks BILLING_ENABLED first; this calls
 * `rpc_transition_bill`, which decides everything real: project membership,
 * the legal transitions, who may make each (only a client certifies or
 * rejects), the rejection reason, the row lock, the event and the audit.
 *
 * draft -> submitted also enqueues the PDF render, keyed per (bill,
 * revision) — see ./pdf.ts for why. Returns only what a caller needs: the
 * bill's id, new status and project (for the web's cache refresh) — never
 * the row, so no internal cost or margin. Errors are the RPC's own, thrown
 * as `Error(message)`, so each caller's mapDomainError applies unchanged.
 * No caching or revalidation here — that is the web action's concern.
 */
export async function transitionBillFor(
  // Unused today: the RPC reads the caller from the JWT on this client. Kept
  // so every shared write helper has the same shape (transitionStockRequestFor).
  _session: Session,
  input: { billId: string; toStatus: BillTransitionStatus; note?: string }
): Promise<{ id: string; status: string; projectId: string }> {
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
  //
  // The key is per (bill, revision), not per (bill, status): a client
  // rejection sends the bill back to draft with `revision = revision + 1`,
  // and the resubmission that follows must render its own document. Keyed on
  // status alone it collided with the first submission under `jobs_idem_uq`
  // and no second job was ever created — the client then certified against
  // the pre-rejection PDF. See `./pdf.ts`.
  if (row.status === "submitted") {
    await enqueue("bill.pdf", { billId: row.id }, { idempotencyKey: billPdfJobKey(row.id, row.revision) });
  }

  return { id: row.id, status: row.status, projectId: row.project_id };
}
