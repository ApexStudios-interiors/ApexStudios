import { z } from "zod";

/** build/09-billing.md §4.4, 02-lld.md §7. */

const billLineSelectionSchema = z.object({
  sourceType: z.enum(["phase", "material"]),
  sourceId: z.uuid(),
});

export const createBillSchema = z.object({
  projectId: z.uuid(),
  lines: z.array(billLineSelectionSchema).min(1, "Select at least one item to bill"),
  billDate: z.iso.date().optional(),
  notes: z.string().trim().optional(),
  // Generated once per dialog instance, same client-generated-id shape as
  // every other create flow in this app — "a double-clicked Create Bill
  // button must not produce two RA bills" (build §4.1).
  idempotencyKey: z.uuid(),
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
  reason: z.string().trim().min(1, "Please give a reason"),
});
export type RejectBillInput = z.infer<typeof rejectBillSchema>;

export const recordPaymentSchema = z.object({
  billId: z.uuid(),
  amount: z.coerce.number().positive("Amount must be positive"),
  paidOn: z.iso.date(),
  mode: z.enum(["neft", "cheque", "upi", "rtgs"]).optional(),
  referenceNo: z.string().trim().optional(),
  idempotencyKey: z.uuid(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const uploadBillCopySchema = z.object({
  billId: z.uuid(),
  attachmentIds: z.array(z.uuid()).min(1),
});
export type UploadBillCopyInput = z.infer<typeof uploadBillCopySchema>;
