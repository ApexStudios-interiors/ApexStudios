import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/projects/abc?tab=billing")).toBe("/projects/abc?tab=billing");
  });

  it.each([null, undefined, "", "https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)"])(
    "falls back to / for %s",
    (next) => {
      expect(safeNext(next)).toBe("/");
    }
  );
});
