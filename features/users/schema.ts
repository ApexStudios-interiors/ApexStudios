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
 * Add User. No email and no password in the input: the email is derived from
 * the username and the password is generated on the server, so neither is
 * ever chosen by, or sent from, the browser.
 *
 * `owner` is not assignable here. D8 names the one owner, and setUserRole is
 * owner-only (lib/rbac/permissions.ts) — an admin creating an owner would be
 * the escalation that rule exists to prevent.
 */
export const addUserSchema = z.object({
  username: usernameSchema,
  fullName: z.string().trim().max(120).optional(),
  role: z.enum(["admin", "site", "client"]),
});
export type AddUserInput = z.infer<typeof addUserSchema>;
