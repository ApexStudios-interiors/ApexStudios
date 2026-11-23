import { z } from "zod";

export const adjustInventorySchema = z.object({
  itemId: z.uuid(),
  newQty: z.coerce.number().min(0, "Quantity cannot be negative"),
  reason: z.string().trim().min(1, "A reason is required"),
});
export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;

/** APX-15: Minimum stock (reorder_level), set by an admin through
 *  rpc_set_inventory_reorder_level (audited). */
export const setReorderLevelSchema = z.object({
  itemId: z.uuid(),
  reorderLevel: z.coerce.number().min(0, "Minimum stock cannot be negative"),
});
export type SetReorderLevelInput = z.infer<typeof setReorderLevelSchema>;

/** APX-69: material used on site, against a package — rpc_record_stock_usage
 *  writes an 'out' movement, never more than is on hand. */
export const recordUsageSchema = z.object({
  itemId: z.uuid(),
  packageId: z.uuid("Select a package"),
  qty: z.coerce.number().positive("Quantity used must be more than 0"),
  note: z.string().trim().max(500, "Keep the note under 500 characters").optional(),
});
export type RecordUsageInput = z.infer<typeof recordUsageSchema>;
