import { z } from "zod";
import {
  LOCATION_MAX_LENGTH,
  PACKAGE_NAME_MAX_LENGTH,
  RATE_VISIBILITY_MODES,
  isValidLocation,
  isValidPackageName,
} from "./service";

/**
 * Location — optional, but not a dumping ground. Light on purpose: an Indian
 * site address has no fixed shape, so all that is asked is that it contains a
 * letter somewhere and is not longer than the column's practical limit. A bare
 * phone number is rejected; "Ghanpur, Hyderabad" is not.
 */
export const LOCATION_MESSAGE = "Enter a location that includes a place name, or leave it empty.";

const locationField = z
  .string()
  .trim()
  .max(LOCATION_MAX_LENGTH, `Location must be ${LOCATION_MAX_LENGTH} characters or fewer`)
  .refine(isValidLocation, LOCATION_MESSAGE);

/** Named for the offending entry, so the person can see which one to fix. */
export function packageNameMessage(name: string): string {
  return `"${name}" is not a valid package name — use letters, numbers, spaces and & - . / only, up to ${PACKAGE_NAME_MAX_LENGTH} characters.`;
}

/**
 * Packages — the dialog's comma-separated field, already split. Blank entries
 * are dropped rather than rejected (a trailing comma is a typo, not an error);
 * anything else has to be a name. Duplicates within one submission are dropped
 * by `normalisePackageNames` in the action, which is the only thing that
 * decides what is actually created.
 */
const packagesField = z
  .array(z.string())
  .default([])
  .superRefine((names, ctx) => {
    names.forEach((raw, index) => {
      const name = raw.trim();
      if (name === "") return;
      if (!isValidPackageName(name)) {
        ctx.addIssue({ code: "custom", path: [index], message: packageNameMessage(name) });
      }
    });
  });

/**
 * 02-lld.md §7. The action and the form parse this same object. There is no
 * `code`: it is generated server-side from `name` (features/projects/service.ts
 * and rpc_create_project), so a browser cannot choose one.
 */
export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  clientId: z.uuid("Select or create a client"),
  location: locationField.optional(),
  startDate: z.iso.date(),
  /** Named packages to create alongside the project, one transaction (§4.1). */
  packages: packagesField,
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/** The dialog's read-only code preview. */
export const previewProjectCodeSchema = z.object({
  name: z.string().trim().min(1),
});

/** Inline "Create «name»" from the New Project dialog's Client combobox. */
export const createClientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required").max(200),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateProjectSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).optional(),
  location: z.string().trim().optional(),
  targetEndDate: z.iso.date().optional(),
  contractValue: z.string().optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const setProjectStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(["planning", "active", "on_hold", "completed", "archived"]),
});
export type SetProjectStatusInput = z.infer<typeof setProjectStatusSchema>;

/** D55 — the project dashboard's "Rate visibility" card. Owner/admin only;
 *  `adminAction` is the guard, this is only the shape. */
export const setProjectRateVisibilitySchema = z.object({
  id: z.uuid(),
  rateVisibility: z.enum(RATE_VISIBILITY_MODES),
});
export type SetProjectRateVisibilityInput = z.infer<typeof setProjectRateVisibilitySchema>;

export const addProjectMemberSchema = z.object({
  projectId: z.uuid(),
  profileId: z.uuid(),
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
