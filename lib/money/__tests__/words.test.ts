import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { formatINRInWords, threeDigitsToWords } from "../words";

describe("threeDigitsToWords — wordAt's own out-of-range fallback", () => {
  // Never reachable through integerToWords' own guarded call sites (every
  // real group is 1-999), but `n` is a plain `number` with no type-level
  // bound — this is the shared wordAt() fallback (words.ts's own comment)
  // proving an out-of-range lookup returns an empty word, never the
  // literal string "undefined" printed into a real bill.
  it("an out-of-range hundreds digit falls back to an empty word, not 'undefined'", () => {
    expect(threeDigitsToWords(2000)).toBe(" Hundred");
  });

  it("a normal three-digit number is unaffected by the fallback path", () => {
    expect(threeDigitsToWords(299)).toBe("Two Hundred Ninety Nine");
  });
});

describe("formatINRInWords", () => {
  it("zero", () => {
    expect(formatINRInWords(0)).toBe("Rupees Zero Only");
  });

  it("a small whole amount", () => {
    expect(formatINRInWords(456)).toBe("Rupees Four Hundred Fifty Six Only");
  });

  it("thousands", () => {
    expect(formatINRInWords(4500)).toBe("Rupees Four Thousand Five Hundred Only");
  });

  it("lakhs", () => {
    expect(formatINRInWords(123456)).toBe(
      "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only"
    );
  });

  it("a round lakh — thousand and rest groups both zero", () => {
    expect(formatINRInWords(100000)).toBe("Rupees One Lakh Only");
  });

  it("crores", () => {
    expect(formatINRInWords(12345678)).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only"
    );
  });

  it("with paise", () => {
    expect(formatINRInWords(123456.5)).toBe(
      "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only"
    );
  });

  it("rounds half-up to the paisa, same as formatINR", () => {
    expect(formatINRInWords(100.005)).toBe("Rupees One Hundred and One Paise Only");
  });

  it("a round number carries no 'and Paise' clause at all", () => {
    expect(formatINRInWords(100)).not.toMatch(/Paise/);
  });

  it("a negative amount (a credit note, say) is prefixed Minus", () => {
    expect(formatINRInWords(-500)).toBe("Minus Rupees Five Hundred Only");
  });

  it("ten, a two-digit-irregular number", () => {
    expect(formatINRInWords(10)).toBe("Rupees Ten Only");
  });

  it("nineteen, the top of the irregular teens", () => {
    expect(formatINRInWords(19)).toBe("Rupees Nineteen Only");
  });

  it("twenty, the first regular tens value", () => {
    expect(formatINRInWords(20)).toBe("Rupees Twenty Only");
  });

  it("a tens value with no remainder digit", () => {
    expect(formatINRInWords(50)).toBe("Rupees Fifty Only");
  });

  it("throws on a non-finite input, same contract as formatINR", () => {
    expect(() => formatINRInWords(Number.NaN)).toThrow(TypeError);
  });

  it("accepts a Decimal instance directly, not just number/string", () => {
    expect(formatINRInWords(new Decimal(500))).toBe("Rupees Five Hundred Only");
  });
});
