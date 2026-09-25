import { z } from "zod";

/**
 * The one sign-in form, for every role (D51): username + password. The
 * username becomes an email address in the action (signInEmail in
 * features/users/service.ts), because GoTrue signs in by email.
 *
 * The whitespace asymmetry here is deliberate, not an oversight:
 *
 *   username  trimmed, on purpose. It is an identifier, not a secret, and it
 *             is only ever used to DERIVE the sign-in email — signInEmail()
 *             trims and lowercases it again for exactly that reason. A
 *             leading space copied out of a chat message must not stop a
 *             supervisor signing in.
 *   password  NOT trimmed, on purpose. Trimming would silently change the
 *             secret a person chose: a password that legitimately begins or
 *             ends with a space would be accepted here and rejected by the
 *             database that stored its hash, and everyone's effective
 *             password space would shrink. `.min(1)` only requires that
 *             something was typed.
 */
export const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password"),
});
