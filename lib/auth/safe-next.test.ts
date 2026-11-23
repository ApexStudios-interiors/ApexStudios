import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/projects/abc?tab=billing")).toBe("/projects/abc?tab=billing");
    expect(safeNext("/projects/bhel-nch/billing#bills")).toBe("/projects/bhel-nch/billing#bills");
  });

  it.each([null, undefined, "", "https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)"])(
    "falls back to / for %s",
    (next) => {
      expect(safeNext(next)).toBe("/");
    }
  );

  // APX-27: a browser strips these before parsing, so each of these would
  // otherwise become the protocol-relative "//evil.com".
  it.each([
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/\t\t/evil.com",
    "/\u0000/evil.com",
    "/\\/evil.com",
  ])("falls back to / for a control character or backslash: %j", (next) => {
    expect(safeNext(next)).toBe("/");
  });

  it("an encoded tab that was never decoded stays a harmless same-origin path", () => {
    expect(safeNext("/%09/evil.com")).toBe("/%09/evil.com");
  });

  it("dot segments cannot climb off the origin", () => {
    expect(safeNext("/../../evil.com")).toBe("/evil.com");
  });
});
