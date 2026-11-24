import { Decimal } from "decimal.js";
import { z } from "zod";

/** build/09-billing.md §4.4, 02-lld.md §7. */

const billLineSelectionSchema = z.object({
  sourceType: z.enum(["phase", "material"]),
  sourceId: z.uuid(),
});

export const createBillSchema = z
  .object({
    projectId: z.uuid(),
    lines: z.array(billLineSelectionSchema).min(1, "Select at least one item to bill"),
    // No billDate from the browser (APX-22): the action stamps today in
    // Asia/Kolkata itself, and submission re-stamps it (migration
    // 20261124200002). A client-supplied date could back-date a tax invoice.
    notes: z.string().trim().optional(),
    // The billing period printed on the bill. Optional; both or neither,
    // start on or before end — rpc_create_bill checks the same (INVALID_PERIOD).
    periodFrom: z.iso.date().optional(),
    periodTo: z.iso.date().optional(),
    // Generated once per dialog instance, same client-generated-id shape as
    // every other create flow in this app — "a double-clicked Create Bill
    // button must not produce two RA bills" (build §4.1).
    idempotencyKey: z.uuid(),
  })
  .refine((v) => (v.periodFrom === undefined) === (v.periodTo === undefined), {
    message: "Give both period dates, or neither",
    path: ["periodTo"],
  })
  .refine((v) => !v.periodFrom || !v.periodTo || v.periodFrom <= v.periodTo, {
    message: "The period must start on or before it ends",
    path: ["periodTo"],
  });
export type CreateBillInput = z.infer<typeof createBillSchema>;

export const transitionBillSchema = z.object({
  billId: z.uuid(),
  toStatus: z.enum(["submitted", "cancelled", "certified", "draft", "paid"]),
  note: z.string().trim().optional(),
});
export type TransitionBillInput = z.infer<typeof transitionBillSchema>;

/** Reject is `transitionBill({ toStatus: "draft" })` under the hood, but
 *  gets its own schema so the client-side "reason is required" check can
 *  run before the round trip, same as `RejectStockRequestDialog`'s own
 *  established pattern. */
export const rejectBillSchema = z.object({
  billId: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(1, "Please give a reason")
    .max(1000, "Keep the reason to 1,000 characters or fewer"),
});
export type RejectBillInput = z.infer<typeof rejectBillSchema>;

export const recordPaymentSchema = z.object({
  billId: z.uuid(),
  // At most two decimals (APX-60): a payment is money, stored to the paisa.
  // rpc_record_payment rounds as well; this refuses a third decimal instead of
  // letting it be rounded silently.
  amount: z.coerce
    .number()
    .positive("Amount must be positive")
    .refine((n) => new Decimal(n).decimalPlaces() <= 2, "Use at most two decimals (paise)"),
  paidOn: z.iso.date(),
  // Free text in the database (`payments.mode` is `text`, no check
  // constraint), so this list is the only thing that fixes the vocabulary —
  // widening it needs no migration. Stored values stay lowercase.
  mode: z.enum(["neft", "cheque", "upi", "rtgs", "cash", "bank_transfer"]).optional(),
  referenceNo: z.string().trim().optional(),
  idempotencyKey: z.uuid(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const uploadBillCopySchema = z.object({
  billId: z.uuid(),
  attachmentIds: z.array(z.uuid()).min(1),
});
export type UploadBillCopyInput = z.infer<typeof uploadBillCopySchema>;
