/**
 * The two names that tie a bill's generated invoice PDF to the exact
 * revision of the bill it was rendered from. Pure, no `next/*` and no
 * `server-only`: `features/billing/actions.ts` (which enqueues the job) and
 * `lib/jobs/handlers/bill.pdf.ts` (which runs it) must agree on both, and a
 * disagreement is exactly the class of bug this file exists to close.
 *
 * Neither function computes, re-derives or restates a single figure. A
 * bill's own money columns are snapshotted by `rpc_create_bill` and are
 * immutable from `submitted` onward (AGENTS.md billing rules); regenerating
 * the PDF re-renders the SAME stored figures onto a fresh document, it does
 * not recompute them.
 *
 * Why revision at all: `rpc_transition_bill`'s submitted -> draft path
 * (a client rejection) does `revision = revision + 1`, and the admin then
 * resubmits. Keying the render job on `${billId}:submitted` alone meant the
 * resubmission collided with the first submission's key under `jobs_idem_uq`
 * (`rpc_enqueue_job`'s own `on conflict (name, idempotency_key) do nothing`),
 * so no second job was ever created — and even if one had been, the handler's
 * own "already generated?" check keyed on `${bill_no}.pdf` would have found
 * the first revision's attachment and returned. The document the client
 * certifies against would still be the pre-rejection one, while everything
 * rendered live rather than snapshotted (Apex's own GSTIN/PAN/address and
 * bank block, the client's name/GSTIN/billing address) could have been
 * corrected in between — which is the usual reason a bill is rejected in the
 * first place.
 */

/** `bills.revision` starts at 1 (migration 0010) and only ever increases. */
const FIRST_REVISION = 1;

/**
 * The `bill.pdf` job's idempotency key. Stable for a given (bill, revision)
 * — a double-clicked Submit, or a retried Server Action, still enqueues one
 * job (AGENTS.md background job rule 1) — and different for the next
 * revision of the same bill, which is the whole point.
 */
export function billPdfJobKey(billId: string, revision: number): string {
  return `${billId}:submitted:r${revision}`;
}

/**
 * The generated PDF's `attachments.file_name`, and the handler's own
 * idempotency check. Revision 1 keeps the plain `RA-<code>-<seq>.pdf` name
 * the client already downloads today; a later revision gets its own name so
 * the earlier document is superseded rather than silently overwritten —
 * `getBillPdfUrl` serves the one named for the bill's current revision
 * (getCurrentBillPdfKey), and the superseded one stays on the bill as the
 * record of what the client was actually shown before.
 */
export function billPdfFileName(billNo: string, revision: number): string {
  return revision > FIRST_REVISION ? `${billNo}-R${revision}.pdf` : `${billNo}.pdf`;
}

/**
 * Whether a bill in this status has an invoice to render (APX-35 / APX-62).
 * Only an ISSUED bill: submitted, or certified / paid after it. A draft — never
 * sent, or sent back by the client's rejection before the job ran — and a
 * cancelled draft have none; rendering one would turn unsent figures into a
 * downloadable invoice. Certified and paid are included deliberately: a
 * client may certify before the job has run (or a failed job is retried
 * later), and the figures are immutable from submitted onward, so the
 * document is the same one it would have been.
 */
export function billHasInvoice(status: string): boolean {
  return status === "submitted" || status === "certified" || status === "paid";
}
