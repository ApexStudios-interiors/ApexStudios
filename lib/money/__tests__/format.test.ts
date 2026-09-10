import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { formatINR, formatINRCompact } from "../index";

describe("T-20: formatINR produces Indian grouping", () => {
  it("groups the last three digits, then pairs", () => {
    expect(formatINR(123456)).toBe("₹1,23,456.00");
    expect(formatINR(1234567)).toBe("₹12,34,567.00");
    expect(formatINR(12345678)).toBe("₹1,23,45,678.00");
  });

  it("does not group below a thousand", () => {
    expect(formatINR(0)).toBe("₹0.00");
    expect(formatINR(7)).toBe("₹7.00");
    expect(formatINR(999)).toBe("₹999.00");
    expect(formatINR(1000)).toBe("₹1,000.00");
  });

  it("always shows two decimal places", () => {
    expect(formatINR(1.5)).toBe("₹1.50");
    expect(formatINR("1234.5")).toBe("₹1,234.50");
  });

  it("puts the sign before the symbol", () => {
    expect(formatINR(-123456)).toBe("-₹1,23,456.00");
    expect(formatINR(-0.5)).toBe("-₹0.50");
  });

  it("rounds half-up, not half-even", () => {
    expect(formatINR("1.005")).toBe("₹1.01");
    expect(formatINR("1.015")).toBe("₹1.02");
    expect(formatINR("2.675")).toBe("₹2.68");
  });

  it("accepts the string form Postgres numeric returns, without a float round-trip", () => {
    expect(formatINR("99999999999.99")).toBe("₹99,99,99,99,999.99");
    expect(formatINR(new Decimal("12345.678"))).toBe("₹12,345.68");
  });

  it("rejects a non-finite amount rather than printing NaN", () => {
    expect(() => formatINR(Number.NaN)).toThrow(TypeError);
    expect(() => formatINR(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("T-20: L and Cr thresholds are correct at the boundaries", () => {
  it("falls back to full precision below one lakh", () => {
    expect(formatINRCompact(99999)).toBe("₹99,999.00");
    expect(formatINRCompact(99999.99)).toBe("₹99,999.99");
  });

  it("switches to L at exactly one lakh", () => {
    expect(formatINRCompact(100000)).toBe("₹1.00 L");
    expect(formatINRCompact(1250000)).toBe("₹12.50 L");
    expect(formatINRCompact(9999999)).toBe("₹100.00 L");
  });

  it("switches to Cr at exactly one crore", () => {
    expect(formatINRCompact(10000000)).toBe("₹1.00 Cr");
    expect(formatINRCompact(15000000)).toBe("₹1.50 Cr");
    expect(formatINRCompact(123456789)).toBe("₹12.35 Cr");
  });

  it("keeps the sign in front for negatives", () => {
    expect(formatINRCompact(-1250000)).toBe("-₹12.50 L");
    expect(formatINRCompact(-15000000)).toBe("-₹1.50 Cr");
    expect(formatINRCompact(-999)).toBe("-₹999.00");
  });
});
