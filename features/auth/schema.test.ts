import { describe, expect, it } from "vitest";
import { loginSchema } from "./schema";

/**
 * D61 (2026-09-28): both sign-in fields are trimmed. Pinned here because the
 * password half is a deliberate departure from the usual "never modify a
 * submitted password" advice, and is only safe while every SETTER trims too
 * (features/users/schema.test.ts covers that end).
 */
describe("loginSchema", () => {
  it("trims spaces around the username", () => {
    const r = loginSchema.parse({ username: "  owner  ", password: "correct-horse" });
    expect(r.username).toBe("owner");
  });

  it("trims spaces around the password", () => {
    const r = loginSchema.parse({ username: "owner", password: "  correct-horse  " });
    expect(r.password).toBe("correct-horse");
  });

  it("trims a tab or newline pasted in, not just spaces", () => {
    const r = loginSchema.parse({ username: "\towner\n", password: "\tcorrect-horse\n" });
    expect(r).toEqual({ username: "owner", password: "correct-horse" });
  });

  it("leaves spaces INSIDE a password alone", () => {
    // Trimming the ends must not turn into stripping whitespace: a passphrase
    // is a legitimate and encouraged choice.
    const r = loginSchema.parse({ username: "owner", password: "  four word pass phrase  " });
    expect(r.password).toBe("four word pass phrase");
  });

  it("rejects a username that is only whitespace", () => {
    const r = loginSchema.safeParse({ username: "   ", password: "correct-horse" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Enter your username");
  });

  it("rejects a password that is only whitespace", () => {
    // Before the trim this passed .min(1) on the spaces alone, and the user
    // got GoTrue's "Invalid login credentials" instead of a field error.
    const r = loginSchema.safeParse({ username: "owner", password: "     " });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Enter your password");
  });

  it("still rejects both fields empty", () => {
    const r = loginSchema.safeParse({ username: "", password: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues).toHaveLength(2);
  });
});
