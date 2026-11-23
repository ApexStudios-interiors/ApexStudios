import { z } from "zod";
import { todayIst } from "@/lib/dates";
import { stripMoneyFormatting } from "@/lib/money/input";

/**
 * The unit codes `public.units` is seeded with
 * (supabase/migrations/20260909170006_inventory_and_movements.sql). Adding a
 * unit is a migration inserting a row AND an entry here —
 * features/stock/__tests__/units.test.ts fails until the two agree.
 */
export const UNIT_CODES = ["bag", "sft", "kit", "len", "can", "sqm", "rft", "nos", "set"] as const;
export type UnitCode = (typeof UNIT_CODES)[number];

/** APX-40: free-text bounds — a field message, not a database error. */
export const MATERIAL_NAME_MAX = 120;
export const NOTE_MAX = 1000;

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
  materialName: z
    .string()
    .trim()
    .min(1, "Material name is required")
    .max(MATERIAL_NAME_MAX, `Keep the material name to ${MATERIAL_NAME_MAX} characters or fewer`),
  qty: z.coerce
    .number({ error: "Enter a quantity, like 25 or 12.5" })
    .positive("Quantity must be positive")
    .max(99_999_999_999, "That quantity is too large"),
  // APX-40: the fixed list `public.units` is seeded with. A bad unit used to
  // reach the foreign key and come back as "Something went wrong".
  unit: z.enum(UNIT_CODES, { error: "Choose a unit" }),
  // `z.coerce.number()` alone coerces "" to 0 before `.optional()` ever sees
  // it — found live via review: a blank Rate field silently submitted a
  // real rate of ₹0 instead of "not specified." Preprocessing "" to
  // undefined first is the same "" -> undefined shape as phaseId/neededBy
  // above, just ahead of the coercion instead of after it.
  // Grouping commas ("1,250") are stripped first, the same as every other
  // money field (lib/money/input, APX-40).
  rate: z.preprocess(
    (v) => (v === "" ? undefined : typeof v === "string" ? stripMoneyFormatting(v) : v),
    z.coerce
      .number({ error: "Enter a rate, like 1,250 or 1250.50" })
      .nonnegative("Rate cannot be negative")
      .optional()
  ),
  neededBy: z
    .union([z.iso.date(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || v >= todayIst(), NOT_IN_THE_PAST),
  note: z.string().trim().max(NOTE_MAX, `Keep the note to ${NOTE_MAX} characters or fewer`).optional(),
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

export const transitionStockRequestSchema = z.object({
  requestId: z.uuid(),
  toStatus: z.enum(["approved", "rejected", "ordered", "delivered"]),
  note: z.string().trim().max(NOTE_MAX, `Keep the note to ${NOTE_MAX} characters or fewer`).optional(),
});
export type TransitionStockRequestInput = z.infer<typeof transitionStockRequestSchema>;
