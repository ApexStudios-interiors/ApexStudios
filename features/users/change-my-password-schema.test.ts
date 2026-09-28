import { describe, expect, it } from "vitest";
import { changeMyPasswordSchema } from "./schema";

/**
 * D61 (2026-09-28): the SETTER half of the login trim. Login trims the
 * password, which is only safe because what gets stored was trimmed too —
 * otherwise a password set with a trailing space becomes un-enterable.
 */
describe("changeMyPasswordSchema — whitespace (D61)", () => {
  const ok = "correct-horse-battery";

  it("trims all three fields", () => {
    const r = changeMyPasswordSchema.parse({
      currentPassword: "  old-one-here  ",
      newPassword: `  ${ok}  `,
      confirmPassword: `  ${ok}  `,
    });
    expect(r.currentPassword).toBe("old-one-here");
    expect(r.newPassword).toBe(ok);
    expect(r.confirmPassword).toBe(ok);
  });

  it("counts length AFTER trimming, so padding cannot reach the minimum", () => {
    // "          a" is 11 spaces + 1 char. Untrimmed it clears a 12-character
    // floor; trimmed it is one character and must be refused.
    const r = changeMyPasswordSchema.safeParse({
      currentPassword: "old-one-here",
      newPassword: "           a",
      confirmPassword: "           a",
    });
    expect(r.success).toBe(false);
  });

  it("matches two values that differ only in padding", () => {
    const r = changeMyPasswordSchema.safeParse({
      currentPassword: "old-one-here",
      newPassword: ok,
      confirmPassword: `  ${ok}  `,
    });
    expect(r.success).toBe(true);
  });

  it("still refuses a new password equal to the current one after trimming", () => {
    // Padding must not be a way past the "choose a different password" rule.
    const r = changeMyPasswordSchema.safeParse({
      currentPassword: ok,
      newPassword: `  ${ok}  `,
      confirmPassword: `  ${ok}  `,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("newPassword"))).toBe(true);
    }
  });

  it("keeps spaces inside a passphrase", () => {
    const phrase = "four word pass phrase";
    const r = changeMyPasswordSchema.parse({
      currentPassword: "old-one-here",
      newPassword: `  ${phrase}  `,
      confirmPassword: `  ${phrase}  `,
    });
    expect(r.newPassword).toBe(phrase);
  });
});
