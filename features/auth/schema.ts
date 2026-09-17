import { z } from "zod";

/**
 * The one sign-in form, for every role (D51): username + password. The
 * username becomes an email address in the action (signInEmail in
 * features/users/service.ts), because GoTrue signs in by email.
 */
export const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password"),
});
