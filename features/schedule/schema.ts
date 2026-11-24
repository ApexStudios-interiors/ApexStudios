import { z } from "zod";

/** 02-lld.md §7. The dialogs and the actions parse this same object. */

/** APX-40: limits on free text, so an over-long paste is a field message
 *  rather than a database error surfacing as "Something went wrong". */
export const TASK_NAME_MAX = 120;
export const TASK_NOTE_MAX = 2000;

export const DURATION_MESSAGE = "Enter a whole number of weeks from 1 to 104";

/** tasks_duration_ck: between 1 and 104. Blank, 0, a decimal or 105+ all get
 *  the same plain message instead of zod's "Too small: expected number…". */
const durationWeeksField = z.coerce
  .number({ error: DURATION_MESSAGE })
  .int({ error: DURATION_MESSAGE })
  .min(1, { error: DURATION_MESSAGE })
  .max(104, { error: DURATION_MESSAGE });

const taskNameField = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(TASK_NAME_MAX, `Keep the task name to ${TASK_NAME_MAX} characters or fewer`);

export const createTaskSchema = z.object({
  phaseId: z.uuid(),
  name: taskNameField,
  // The Owner select's "no owner" choice reaches the form as "" (the shadcn
  // Select's null item is mapped back to "" at the control), which
  // z.uuid().optional() rejects outright — see features/packages/schema.ts's
  // identical fix for leadProfileId, the same root cause.
  ownerProfileId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  startDate: z.iso.date({ error: "Choose a start date" }),
  durationWeeks: durationWeeksField,
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  id: z.uuid(),
  name: taskNameField.optional(),
  startDate: z.iso.date({ error: "Choose a start date" }).optional(),
  durationWeeks: durationWeeksField.optional(),
  note: z
    .string()
    .trim()
    .max(TASK_NOTE_MAX, `Keep the note to ${TASK_NOTE_MAX} characters or fewer`)
    .optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const setTaskProgressSchema = z.object({
  id: z.uuid(),
  progressPct: z.coerce.number().int().min(0).max(100),
});
export type SetTaskProgressInput = z.infer<typeof setTaskProgressSchema>;
