import { z } from "zod";
import { BELL_KINDS } from "./service";

/**
 * The `kind` values the bell lists, and so the only ones a user can open and
 * mark read (D60; widened by D72 on 2026-11-24 to the status-change kinds).
 * Validated here rather than taken as free text so a client cannot fill
 * `notification_reads` with arbitrary rows — the table has no foreign key on
 * `kind` by design (the view unions unrelated tables), so this schema is
 * where that shape is held. The inbox-only kinds are deliberately absent:
 * the inbox has no read state, its rows leave when the work is done.
 */
export const notificationKindSchema = z.enum(BELL_KINDS);

export const markNotificationReadSchema = z.object({
  kind: notificationKindSchema,
  entityId: z.uuid(),
});
export type MarkNotificationReadInput = z.infer<typeof markNotificationReadSchema>;
