import { z } from "zod";

export const adjustInventorySchema = z.object({
  itemId: z.uuid(),
  newQty: z.coerce.number().min(0, "Quantity cannot be negative"),
  reason: z.string().trim().min(1, "A reason is required"),
});
export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;
