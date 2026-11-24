import { describe, expect, it } from "vitest";
import { dmy, initials, pct } from "./format";

describe("pct", () => {
  it("rounds to a whole percentage", () => {
    expect(pct(1, 3)).toBe(33);
    expect(pct(2, 3)).toBe(67);
  });
  it("is 0, not NaN, over a zero denominator", () => {
    expect(pct(5, 0)).toBe(0);
  });
});

describe("dmy", () => {
  it("formats a yyyy-MM-dd string on its own calendar date", () => {
    expect(dmy("2026-09-06")).toBe("06 Sep 2026");
    expect(dmy("2026-01-31")).toBe("31 Jan 2026");
  });
  it("renders a dash for an empty or malformed value", () => {
    expect(dmy(null)).toBe("–");
    expect(dmy(undefined)).toBe("–");
    expect(dmy("")).toBe("–");
    expect(dmy("2026-09")).toBe("–");
  });
});

describe("initials", () => {
  it("takes the first letter of up to two words", () => {
    expect(initials("Ravi Kumar")).toBe("RK");
    expect(initials("Anita Rao Iyer")).toBe("AR");
    expect(initials("Voola")).toBe("V");
  });
});
