import { z } from "zod";
import { todayIst } from "@/lib/dates";

/** The needed-by field cannot be in the past — today itself is allowed. The
 *  boundary is `todayIst()`, the one "today" this business keeps (lib/dates),
 *  never the host clock or a UTC date. Evaluated per parse, not at module
 *  load, so a process that outlives midnight IST still compares against the
 *  right day. It is enforced HERE rather than only on the picker because the
 *  same schema is what the Server Action parses: a crafted request that never
 *  touches the calendar meets the identical rule. */
const NOT_IN_THE_PAST = "Needed-by date cannot be in the past";

/** build/07-stock-inventory-notifications.md §2.2. `rate` is optional and
 *  admin-only — `createStockRequest` strips it server-side for anyone else
 *  before it ever reaches the RPC (the RPC also refuses to store it for a
 *  non-admin caller, as a second, harder boundary). */
export const createStockRequestSchema = z.object({
  // APX-44: generated once by the form (and optionally by the mobile app), so
  // a retry after a lost response is recognised as the same request and
  // answered "already submitted" instead of raising a second one.
  id: z.uuid().optional(),
  projectId: z.uuid(),
  packageId: z.uuid(),
  // The "" -> undefined pattern (features/packages/schema.ts's own fix,
  // reused throughout since Build 04): a native <select>'s "none" option
  // submits "", which z.uuid().optional() rejects outright.
  phaseId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  inventoryItemId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  materialName: z.string().trim().min(1, "Material name is required"),
  qty: z.coerce.number().positive("Quantity must be positive"),
  unit: z.string().trim().min(1, "Unit is required"),
  // `z.coerce.number()` alone coerces "" to 0 before `.optional()` ever sees
  // it — found live via review: a blank Rate field silently submitted a
  // real rate of ₹0 instead of "not specified." Preprocessing "" to
  // undefined first is the same "" -> undefined shape as phaseId/neededBy
  // above, just ahead of the coercion instead of after it.
  rate: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().nonnegative("Rate cannot be negative").optional()
  ),
  neededBy: z
    .union([z.iso.date(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || v >= todayIst(), NOT_IN_THE_PAST),
  note: z.string().trim().optional(),
});
export type CreateStockRequestInput = z.infer<typeof createStockRequestSchema>;

/** The form's non-blocking "already delivered" check (features/stock/service.ts
 *  `isDuplicateOfDelivered`). Only ever asked once all three matched fields
 *  are present, so every field is required here. */
export const duplicateRequestCheckSchema = z.object({
  projectId: z.uuid(),
  inventoryItemId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  materialName: z.string().trim().min(1),
  qty: z.coerce.number().positive(),
  neededBy: z.iso.date(),
});
export type DuplicateRequestCheckInput = z.infer<typeof duplicateRequestCheckSchema>;

/** "" -> undefined ahead of the number coercion — the same reason as `rate`
 *  above: z.coerce.number() alone turns a blank field into a real 0. */
const optionalNumber = <T extends z.ZodType>(n: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), n.optional());

export const transitionStockRequestSchema = z.object({
  requestId: z.uuid(),
  toStatus: z.enum(["approved", "rejected", "ordered", "delivered", "cancelled"]),
  note: z.string().trim().optional(),
  // APX-14: admin only, on approval. The RPC refuses it from anyone else and
  // on any other move, and refuses to approve a rate-less request without it.
  rate: optionalNumber(z.coerce.number().nonnegative("Rate cannot be negative")),
  // APX-69: a part delivery. Omitted = the whole request.
  deliveredQty: optionalNumber(z.coerce.number().positive("Delivered quantity must be more than 0")),
});
export type TransitionStockRequestInput = z.infer<typeof transitionStockRequestSchema>;

/** APX-42: rpc_edit_stock_request — the three fields a pending request may
 *  change. All three are sent every time: a blank needed-by or note clears it. */
export const editStockRequestSchema = z.object({
  requestId: z.uuid(),
  qty: z.coerce.number().positive("Quantity must be positive"),
  neededBy: z
    .union([z.iso.date(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  note: z.string().trim().optional(),
});
export type EditStockRequestInput = z.infer<typeof editStockRequestSchema>;

/** APX-14: rpc_set_stock_request_rate — admin, until delivery. */
export const setStockRequestRateSchema = z.object({
  requestId: z.uuid(),
  rate: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number({ error: "Enter a rate" }).nonnegative("Rate cannot be negative")
  ),
});
export type SetStockRequestRateInput = z.infer<typeof setStockRequestRateSchema>;
