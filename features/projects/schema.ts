import { z } from "zod";
import { moneyString } from "@/features/packages/schema";
import {
  LOCATION_MAX_LENGTH,
  PACKAGE_NAME_MAX_LENGTH,
  PROJECT_STATUSES,
  RATE_VISIBILITY_MODES,
  isValidLocation,
  isValidPackageName,
  isValidPercent,
} from "./service";

/**
 * Location — optional, but not a dumping ground. Light on purpose: an Indian
 * site address has no fixed shape, so all that is asked is that it contains a
 * letter somewhere and is not longer than the column's practical limit. A bare
 * phone number is rejected; "Ghanpur, Hyderabad" is not.
 */
/** APX-40: an upper bound on free text, so an over-long paste is a field
 *  message, not a database error. */
export const PROJECT_NAME_MAX = 120;

export const LOCATION_MESSAGE = "Enter a location that includes a place name, or leave it empty.";

const locationField = z
  .string()
  .trim()
  .max(LOCATION_MAX_LENGTH, `Location must be ${LOCATION_MAX_LENGTH} characters or fewer`)
  .refine(isValidLocation, LOCATION_MESSAGE);

/** A project name, on every path that sets one. Defined once so create and
 *  update cannot drift apart. */
const nameField = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(PROJECT_NAME_MAX, `Keep the name to ${PROJECT_NAME_MAX} characters or fewer`);

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
  name: nameField,
  clientId: z.uuid("Select or create a client"),
  location: locationField.optional(),
  startDate: z.iso.date({ error: "Choose a start date" }),
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

/**
 * Editing an existing project. Every field it shares with the create path is
 * built from the SAME `nameField` / `locationField`, so a value the New Project
 * dialog refuses cannot be set by editing instead — the two schemas cannot
 * disagree, because there is only one definition of each rule. It carries no
 * package names: packages are created by `createProject` and maintained by the
 * packages feature, never by this action.
 */
/** A percentage as projects stores it — numeric(6,3), 0 to 100. Strings end to
 *  end, like money (code-standards §6), so 18.000 is never 17.999999. */
const percentField = z
  .string()
  .trim()
  .refine(isValidPercent, "Enter a percentage from 0 to 100, up to 3 decimals (e.g. 18 or 2.5)");

/**
 * Every field optional, so a caller sends only what it changes; the Edit
 * Project dialog sends them all. Money uses the same `moneyString` as
 * packages and phases — digits with up to two decimals, so neither NaN nor a
 * negative can reach `Number()` in the action (APX-11: `contractValue` used
 * to be any string at all). An empty Target end date clears it.
 */
export const updateProjectSchema = z.object({
  id: z.uuid(),
  name: nameField.optional(),
  location: locationField.optional(),
  targetEndDate: z.union([z.iso.date(), z.literal("")]).optional(),
  contractValue: moneyString.optional(),
  gstRatePct: percentField.optional(),
  retentionPct: percentField.optional(),
  masBillablePct: percentField.optional(),
  tdsPct: percentField.optional(),
  mobilisationAdvance: moneyString.optional(),
  mobilisationRecoveryPct: percentField.optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/**
 * APX-11: rpc_set_project_status decides whether the move is legal and
 * whether a reason was needed (a reopen); this is only the shape.
 */
export const setProjectStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(PROJECT_STATUSES),
  reason: z.string().trim().max(500, "Keep the reason under 500 characters").optional(),
});
export type SetProjectStatusInput = z.infer<typeof setProjectStatusSchema>;

/** D55 — the project dashboard's "Rate visibility" card. Owner/admin only;
 *  `adminAction` is the guard, this is only the shape. */
export const setProjectRateVisibilitySchema = z.object({
  id: z.uuid(),
  rateVisibility: z.enum(RATE_VISIBILITY_MODES),
});
export type SetProjectRateVisibilityInput = z.infer<typeof setProjectRateVisibilitySchema>;

/** `expectedRole`: the card the request came from (Site team or Client
 *  access) manages one role, and a profile with the other is refused. */
const memberRoleField = z.enum(["client", "site"]).optional();

export const addProjectMemberSchema = z.object({
  projectId: z.uuid(),
  profileId: z.uuid(),
  expectedRole: memberRoleField,
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;

/** Take a client or site supervisor off one project; their other projects are
 *  untouched. */
export const removeProjectMemberSchema = z.object({
  projectId: z.uuid(),
  profileId: z.uuid(),
  expectedRole: memberRoleField,
});
export type RemoveProjectMemberInput = z.infer<typeof removeProjectMemberSchema>;
