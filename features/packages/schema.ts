import { z } from "zod";
import { moneyString } from "@/lib/money/input";

/** 02-lld.md §7. `numeric(14,2)` amounts travel as strings end to end — the
 *  form, the action, and lib/money's Decimal arithmetic never round-trip
 *  through a JS number (docs/code-standards.md §6). `moneyString` is the
 *  shared money schema: it accepts Indian grouping ("1,80,00,000") and strips
 *  it before validating (APX-40). */

/** APX-40: a free-text bound — a field message rather than a database error. */
export const PACKAGE_FIELD_NAME_MAX = 120;
const nameField = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(PACKAGE_FIELD_NAME_MAX, `Keep the name to ${PACKAGE_FIELD_NAME_MAX} characters or fewer`);

/**
 * The Lead select's "unassigned" choice reaches the form as `""`, never
 * `undefined` — originally because a native `<select>` option cannot have no
 * value, and still today because the shadcn Select's `null` "To assign" item
 * is mapped back to `""` at the control boundary so this schema is unchanged.
 * `z.uuid().optional()`
 * rejects `""` outright (a string that isn't a UUID, not an absent field),
 * which failed silently at the CLIENT validation step before the dialog's own
 * submit handler ever ran, well before the value reached the server for its
 * `|| undefined` fallback to help. Accepting `""` here and normalizing it to
 * `undefined` in the same schema both dialogs and the action share is the fix
 * that actually runs at validation time, not after it.
 */
const optionalLeadProfileId = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .transform((v) => (v ? v : undefined));

export const createPackageSchema = z.object({
  projectId: z.uuid(),
  name: nameField,
  allocatedAmount: moneyString,
  internalAmount: moneyString,
  leadProfileId: optionalLeadProfileId,
});
export type CreatePackageInput = z.infer<typeof createPackageSchema>;

export const updatePackageSchema = z.object({
  id: z.uuid(),
  name: nameField.optional(),
  allocatedAmount: moneyString.optional(),
  internalAmount: moneyString.optional(),
  leadProfileId: optionalLeadProfileId,
  status: z.enum(["not_started", "design", "in_progress", "completed"]).optional(),
  /** Optimistic concurrency (build/04-projects-packages-phases.md §4.2): the
   *  `updated_at` this form was loaded with. The action's update is scoped to
   *  `id` AND `updated_at = this value`; a zero-row result means someone else
   *  saved first, and the action reports a conflict instead of silently
   *  overwriting their change. */
  updatedAt: z.string().min(1),
});
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;

export const createPhaseSchema = z.object({
  packageId: z.uuid(),
  name: nameField,
  allocatedAmount: moneyString,
  internalAmount: moneyString,
});
export type CreatePhaseInput = z.infer<typeof createPhaseSchema>;

export const updatePhaseSchema = z.object({
  id: z.uuid(),
  name: nameField.optional(),
  allocatedAmount: moneyString.optional(),
  internalAmount: moneyString.optional(),
});
export type UpdatePhaseInput = z.infer<typeof updatePhaseSchema>;
