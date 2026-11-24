import { z } from "zod";

/**
 * Money as people type it (APX-40). Staff write amounts the Indian way —
 * "1,80,00,000", "₹ 45,000.50" — and the forms used to reject anything but
 * bare digits. Grouping commas, spaces and a leading ₹ are presentation, not
 * value, so they are stripped BEFORE validation, in this one shared schema,
 * and every money field — form and Server Action alike — parses through it.
 *
 * The result is still a plain decimal string (`numeric(14,2)` travels as a
 * string end to end — docs/code-standards.md §6); nothing here goes through a
 * JavaScript number.
 */

/** Remove grouping commas, spaces (incl. non-breaking) and a ₹ / "Rs" prefix. */
export function stripMoneyFormatting(raw: string): string {
  return raw
    .trim()
    .replace(/^(₹|rs\.?|inr)\s*/i, "")
    .replace(/[,\s ]/g, "");
}

/** `numeric(14,2)`: up to 12 whole digits and 2 decimals. */
export const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
export const MONEY_MESSAGE = "Enter an amount like 1,25,000 or 125000.50";

/** A required money amount, as a normalised decimal string ("1,25,000" → "125000"). */
export const moneyString = z.preprocess(
  (v) => (typeof v === "string" ? stripMoneyFormatting(v) : v),
  z.string({ error: MONEY_MESSAGE }).regex(MONEY_PATTERN, MONEY_MESSAGE)
);

/**
 * The live read-back under a money input: the formatted amount when what has
 * been typed so far is a valid amount, otherwise null (show nothing — the
 * field's own validation message says what is wrong on submit).
 */
export function parseMoneyInput(raw: string): string | null {
  const stripped = stripMoneyFormatting(raw);
  return MONEY_PATTERN.test(stripped) ? stripped : null;
}
