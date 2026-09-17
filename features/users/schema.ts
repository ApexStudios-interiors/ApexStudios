import { z } from "zod";

/**
 * The part before the @. Lower-case letters, digits, dots, hyphens and
 * underscores, starting and ending on a letter or digit — every such string is
 * also a valid email local part, so the derived address always parses.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "At least 2 characters")
  .max(32, "At most 32 characters")
  .regex(
    /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/,
    "Letters, digits, dots, hyphens and underscores; start and end with a letter or digit"
  );

/**
 * The roles Add User may create. Staff only.
 *
 * `owner` is not assignable here. D8 names the one owner, and setUserRole is
 * owner-only (lib/rbac/permissions.ts) — an admin creating an owner would be
 * the escalation that rule exists to prevent.
 *
 * `client` is not assignable here either (D51). A client login is created from
 * a project (createClientLogin below), so it always has at least one project
 * it can see; a client made from the Users page would be an account with no
 * project and nothing to do. Keeping it out of the enum, not just out of the
 * dialog, is what stops a crafted request creating one.
 */
export const STAFF_ROLES = ["admin", "site"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Add User. No email and no password in the input: the email is derived from
 * the username and the password is generated on the server, so neither is
 * ever chosen by, or sent from, the browser.
 */
export const addUserSchema = z.object({
  username: usernameSchema,
  fullName: z.string().trim().max(120).optional(),
  role: z.enum(STAFF_ROLES),
});
export type AddUserInput = z.infer<typeof addUserSchema>;

/**
 * Create client login (D51), from a project. Same username and name rules as
 * Add User; the role is always `client` and is not an input at all, and the
 * new account is made a member of `projectId` in the same action.
 */
export const createClientLoginSchema = z.object({
  projectId: z.uuid(),
  username: usernameSchema,
  fullName: z.string().trim().max(120).optional(),
});
export type CreateClientLoginInput = z.infer<typeof createClientLoginSchema>;

/**
 * Reset password (D52). Only the target's id: the password is generated on the
 * server, and the target's role is read from the database, never taken from
 * the request.
 */
export const resetPasswordSchema = z.object({
  userId: z.uuid(),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
