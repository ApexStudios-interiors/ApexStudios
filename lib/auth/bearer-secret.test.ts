import { describe, expect, it } from "vitest";
import { bearerMatches } from "./bearer-secret";

describe("bearerMatches (APX-57)", () => {
  const SECRET = "s3cret-value-for-cron";

  it("accepts exactly `Bearer <secret>`", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    ["a wrong secret", "Bearer nope"],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, -1)}`],
    ["the secret with extra bytes", `Bearer ${SECRET}x`],
    ["the bare secret, no scheme", SECRET],
    ["another scheme", `Basic ${SECRET}`],
    ["an empty header", ""],
  ])("refuses %s", (_label, header) => {
    expect(bearerMatches(header, SECRET)).toBe(false);
  });

  it("refuses a missing header", () => {
    expect(bearerMatches(null, SECRET)).toBe(false);
    expect(bearerMatches(undefined, SECRET)).toBe(false);
  });

  it("never authorises anything when the secret itself is unset", () => {
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
  });
});
