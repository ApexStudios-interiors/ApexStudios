import { Decimal } from "decimal.js";

/**
 * INR formatting. `docs/02-lld.md` §8.4, `docs/code-standards.md` §6.
 *
 *   formatINR(123456)          // '₹1,23,456.00'
 *   formatINRCompact(1250000)  // '₹12.50 L'
 *   formatINRCompact(15000000) // '₹1.50 Cr'
 *
 * Values arrive as strings from Postgres, because `numeric` is returned as text
 * to avoid a float round-trip. Both forms are accepted and neither is converted
 * through a JavaScript number: decimal.js does the arithmetic, so the paisa a
 * bill shows is the paisa the database stored.
 *
 * Rounding is half-up to two decimals. `docs/02-lld.md` §1.4 puts rounding at
 * the point of storage, so display should never be the first place a value is
 * rounded — this is the last line of defence, not the policy.
 */

const LAKH = new Decimal(100_000);
const CRORE = new Decimal(10_000_000);

export type MoneyInput = number | string | Decimal;

function toDecimal(value: MoneyInput): Decimal {
  const d = value instanceof Decimal ? value : new Decimal(value);
  if (!d.isFinite()) {
    throw new TypeError(`formatINR: not a finite amount: ${String(value)}`);
  }
  return d;
}

/** Indian digit grouping: last three digits, then pairs. 1234567 -> 12,34,567 */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}

/** Full precision. Use in tables and on every bill. */
export function formatINR(value: MoneyInput): string {
  const d = toDecimal(value);
  const sign = d.isNegative() ? "-" : "";
  const fixed = d.abs().toFixed(2, Decimal.ROUND_HALF_UP);
  const [whole = "0", fraction = "00"] = fixed.split(".");
  return `${sign}₹${groupIndian(whole)}.${fraction}`;
}

/**
 * Compact form. Stat tiles only — never a table, never a bill.
 * >= 1 crore renders as Cr, >= 1 lakh as L, below that as full precision.
 */
export function formatINRCompact(value: MoneyInput): string {
  const d = toDecimal(value);
  const abs = d.abs();
  const sign = d.isNegative() ? "-" : "";

  if (abs.greaterThanOrEqualTo(CRORE)) {
    return `${sign}₹${abs.dividedBy(CRORE).toFixed(2, Decimal.ROUND_HALF_UP)} Cr`;
  }
  if (abs.greaterThanOrEqualTo(LAKH)) {
    return `${sign}₹${abs.dividedBy(LAKH).toFixed(2, Decimal.ROUND_HALF_UP)} L`;
  }
  return formatINR(d);
}
