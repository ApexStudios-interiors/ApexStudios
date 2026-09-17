import { describe, expect, it } from "vitest";
import { addUserSchema } from "./schema";
import { emailForUsername, generatePassword, GENERATED_PASSWORD_LENGTH } from "./service";

describe("emailForUsername", () => {
  it("derives the seeded staff domain", () => {
    expect(emailForUsername("suresh")).toBe("suresh@beapex.in");
  });
});

describe("addUserSchema", () => {
  it("normalises the username to trimmed lower case", () => {
    const parsed = addUserSchema.parse({ username: "  Suresh.K ", role: "site" });
    expect(parsed.username).toBe("suresh.k");
  });

  it.each(["a", "-lead", "trail.", "has space", "at@sign", "x".repeat(33)])("rejects %j", (username) => {
    expect(addUserSchema.safeParse({ username, role: "site" }).success).toBe(false);
  });

  it("refuses the owner role", () => {
    expect(addUserSchema.safeParse({ username: "boss", role: "owner" }).success).toBe(false);
  });
});

describe("generatePassword", () => {
  it("is long and covers every character class", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword();
      expect(pw).toHaveLength(GENERATED_PASSWORD_LENGTH);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[2-9]/);
      expect(pw).toMatch(/[!@#$%^&*\-_=+?]/);
      expect(pw).not.toMatch(/[0O1lI]/);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generatePassword()));
    expect(seen.size).toBe(500);
  });

  it("rejects out-of-range draws instead of reducing them with a bias", () => {
    // First draw is above every alphabet's rejection limit, so it must be
    // discarded; the rest are 0. A modulo-only implementation would use it.
    let calls = 0;
    const pw = generatePassword((buf) => {
      buf[0] = calls++ === 0 ? 0xffff_ffff : 0;
      return buf;
    });
    expect(calls).toBeGreaterThan(GENERATED_PASSWORD_LENGTH + 4);
    expect(pw).toHaveLength(GENERATED_PASSWORD_LENGTH);
  });
});
