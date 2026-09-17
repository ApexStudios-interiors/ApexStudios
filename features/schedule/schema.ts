import { z } from "zod";

/** 02-lld.md §7. The dialogs and the actions parse this same object. */

export const createTaskSchema = z.object({
  phaseId: z.uuid(),
  name: z.string().trim().min(1, "Name is required"),
  // The Owner select's "no owner" choice reaches the form as "" (the shadcn
  // Select's null item is mapped back to "" at the control), which
  // z.uuid().optional() rejects outright — see features/packages/schema.ts's
  // identical fix for leadProfileId, the same root cause.
  ownerProfileId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  startDate: z.iso.date(),
  // tasks_duration_ck: between 1 and 104.
  durationWeeks: z.coerce.number().int().min(1).max(104),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).optional(),
  startDate: z.iso.date().optional(),
  durationWeeks: z.coerce.number().int().min(1).max(104).optional(),
  note: z.string().trim().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const setTaskProgressSchema = z.object({
  id: z.uuid(),
  progressPct: z.coerce.number().int().min(0).max(100),
});
export type SetTaskProgressInput = z.infer<typeof setTaskProgressSchema>;
