import { z } from "zod";

/**
 * The one sign-in form, for every role (D51): username + password. The
 * username becomes an email address in the action (signInEmail in
 * features/users/service.ts), because GoTrue signs in by email.
 *
 * Both fields are trimmed (D61, 2026-09-28, owner decision after a test round
 * found trailing spaces surviving a paste into either box).
 *
 *   username  an identifier, not a secret, and only ever used to DERIVE the
 *             sign-in email — signInEmail() trims and lowercases it again for
 *             the same reason. A leading space copied out of a chat message
 *             must not stop a supervisor signing in.
 *   password  trimmed too, which is a deliberate departure from the usual
 *             advice (OWASP/NIST: accept a password exactly as typed). Two
 *             things make it safe HERE rather than in general:
 *               - it is trimmed at every SETTER as well (changeMyPasswordSchema),
 *                 so what is hashed and what is checked can never disagree;
 *               - no password in this system was ever chosen with an edge
 *                 space to begin with: Add User and Reset both GENERATE the
 *                 password server-side, and self-service change did not exist
 *                 until 2026-09-25.
 *             Trimming only at login, without the setters, would be a bug —
 *             it would make a password set with a trailing space permanently
 *             un-enterable. Keep the two ends together.
 */
export const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username"),
  password: z.string().trim().min(1, "Enter your password"),
});
