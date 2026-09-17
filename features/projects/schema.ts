import { z } from "zod";

/**
 * 02-lld.md §7. The action and the form parse this same object. There is no
 * `code`: it is generated server-side from `name` (features/projects/service.ts
 * and rpc_create_project), so a browser cannot choose one.
 */
export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  clientId: z.uuid("Select or create a client"),
  location: z.string().trim().optional(),
  startDate: z.iso.date(),
  /** Named packages to create alongside the project, one transaction (§4.1). */
  packages: z.array(z.string().trim().min(1)).default([]),
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

export const addProjectMemberSchema = z.object({
  projectId: z.uuid(),
  profileId: z.uuid(),
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
