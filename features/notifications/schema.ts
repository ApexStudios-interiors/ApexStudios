import { z } from "zod";

/**
 * The four `kind` values `v_notifications` can produce. Validated here rather
 * than taken as free text so a client cannot fill `notification_reads` with
 * arbitrary rows — the table has no foreign key on `kind` by design (the view
 * unions four unrelated tables), so this schema is where that shape is held.
 */
export const notificationKindSchema = z.enum([
  "stock_request",
  "bill_submitted",
  "approval_pending",
  "inventory_low",
]);

export const markNotificationReadSchema = z.object({
  kind: notificationKindSchema,
  entityId: z.uuid(),
});
export type MarkNotificationReadInput = z.infer<typeof markNotificationReadSchema>;
