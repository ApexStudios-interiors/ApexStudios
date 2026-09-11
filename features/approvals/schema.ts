import { z } from "zod";
import { MAX_PHOTOS_PER_ENTITY } from "@/lib/r2/constraints";

/** Mirrors `approval_type` (db/schema/enums.ts). Kept here, not re-derived
 *  from the generated Supabase types, so the zod schema and the RPC's own
 *  `public.approval_type` stay the single obvious place to add a sixth type. */
export const APPROVAL_TYPES = ["material_sample", "drawing", "make_model", "milestone", "other"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

/**
 * `id` is client-generated (`crypto.randomUUID()`, `NewApprovalDialog`), not
 * server-assigned — same reason as `postDailyUpdateSchema`
 * (features/updates/schema.ts): `FileUploader`'s sample photos upload and
 * confirm BEFORE this row exists, so the id has to be chosen first and
 * carried through both the uploads and this insert.
 */
export const requestApprovalSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  packageId: z.uuid(),
  // The "" -> undefined pattern (features/packages/schema.ts's own fix,
  // reused since Build 04): a native <select>'s "none" option submits "".
  phaseId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  type: z.enum(APPROVAL_TYPES),
  item: z.string().trim().min(1, "Item is required"),
  note: z.string().trim().optional(),
  neededBy: z
    .union([z.iso.date(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  attachmentIds: z.array(z.uuid()).max(MAX_PHOTOS_PER_ENTITY).default([]),
  // build §2.3: supersession, not reopening — set only when raising a
  // revised approval from a rejected one (`NewApprovalDialog` pre-filled).
  supersedesId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type RequestApprovalInput = z.infer<typeof requestApprovalSchema>;

/** `ApprovalPhotosDialog` — adding sample photos to an EXISTING, still-pending
 *  approval. The id is server-assigned already (this is not a create flow), so
 *  no client-generated id here. */
export const addSamplePhotosSchema = z.object({
  approvalId: z.uuid(),
  attachmentIds: z.array(z.uuid()).min(1).max(MAX_PHOTOS_PER_ENTITY),
});
export type AddSamplePhotosInput = z.infer<typeof addSamplePhotosSchema>;

/**
 * `decideApproval` — client only. `reason` is required only when rejecting;
 * the RPC enforces that (`REASON_REQUIRED`) but the form should not let a
 * client submit a blank rejection and wait for the round trip to say so.
 */
export const decideApprovalSchema = z
  .object({
    approvalId: z.uuid(),
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().optional(),
  })
  .refine((v) => v.decision !== "rejected" || (v.reason?.length ?? 0) > 0, {
    message: "Please give a reason for rejecting",
    path: ["reason"],
  });
export type DecideApprovalInput = z.infer<typeof decideApprovalSchema>;
