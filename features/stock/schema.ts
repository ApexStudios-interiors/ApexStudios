import { z } from "zod";

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
  materialName: z.string().trim().min(1, "Material name is required"),
  qty: z.coerce.number().positive("Quantity must be positive"),
  unit: z.string().trim().min(1, "Unit is required"),
  rate: z.coerce.number().nonnegative().optional(),
  neededBy: z
    .union([z.iso.date(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  note: z.string().trim().optional(),
});
export type CreateStockRequestInput = z.infer<typeof createStockRequestSchema>;

export const transitionStockRequestSchema = z.object({
  requestId: z.uuid(),
  toStatus: z.enum(["approved", "rejected", "ordered", "delivered"]),
  note: z.string().trim().optional(),
});
export type TransitionStockRequestInput = z.infer<typeof transitionStockRequestSchema>;
