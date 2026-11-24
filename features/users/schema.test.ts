import { describe, expect, it } from "vitest";
import { usernameSchema } from "./schema";

describe("usernameSchema messages (APX-63)", () => {
  it("asks for a username when it is empty", () => {
    const r = usernameSchema.safeParse("   ");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Enter a username");
  });

  it("still explains the 2-character minimum", () => {
    const r = usernameSchema.safeParse("a");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("At least 2 characters");
  });
});
