import { describe, expect, it } from "vitest";
import { moneyString, parseMoneyInput, stripMoneyFormatting } from "../input";

describe("stripMoneyFormatting (APX-40)", () => {
  it.each([
    ["1,80,00,000", "18000000"],
    ["₹ 45,000.50", "45000.50"],
    ["Rs. 1,250", "1250"],
    ["INR 99", "99"],
    ["  12 500 ", "12500"],
    ["1 000", "1000"],
    ["125000", "125000"],
  ])("%s -> %s", (raw, expected) => {
    expect(stripMoneyFormatting(raw)).toBe(expected);
  });
});

describe("moneyString", () => {
  it("accepts Indian grouping and normalises it", () => {
    expect(moneyString.parse("1,80,00,000")).toBe("18000000");
    expect(moneyString.parse("₹45,00,000.50")).toBe("4500000.50");
  });

  it("refuses a non-string outright", () => {
    expect(moneyString.safeParse(125000).success).toBe(false);
  });

  it("refuses what is not an amount, with a readable message", () => {
    for (const bad of ["", "abc", "1.234", "-500", "12,34.5.6", "1234567890123"]) {
      const result = moneyString.safeParse(bad);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.message).toMatch(/Enter an amount/);
    }
  });
});

describe("parseMoneyInput", () => {
  it("returns the plain decimal for a valid amount, else null", () => {
    expect(parseMoneyInput("1,25,000")).toBe("125000");
    expect(parseMoneyInput("1,25,000.5")).toBe("125000.5");
    expect(parseMoneyInput("12a")).toBeNull();
    expect(parseMoneyInput("")).toBeNull();
  });
});
