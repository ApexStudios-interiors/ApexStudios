import { Decimal } from "decimal.js";
import type { MoneyInput } from "./index";

/**
 * build/09-billing.md §4.6: the bill PDF must carry "amount in words." Indian
 * numbering (crore/lakh, not million/billion) — the same grouping
 * `formatINR`'s own `groupIndian` uses for digits, done here in words.
 * Rupees and paise both spelled out, matching a real RA bill's own wording
 * ("Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty
 * Paise Only").
 */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** Converts an integer 1-999 to words — the building block every larger
 *  Indian place value (thousand, lakh, crore) is expressed as a multiple
 *  of. Every call site (`integerToWords` below) already guards with `if
 *  (group)` before calling, so this is never actually invoked with 0 —
 *  no dead zero-guard here to leave untested. */
/** The one place `noUncheckedIndexedAccess`'s fallback lives, shared by
 *  every lookup below — one branch site, not three, so the single genuinely
 *  reachable case (an out-of-range hundreds digit, `threeDigitsToWords`'s
 *  own doc comment) is enough to prove it, instead of needing a separate,
 *  unreachable-by-construction test for each call site. */
function wordAt(table: readonly string[], i: number): string {
  return table[i] ?? "";
}

/** Every real call site only ever passes an integer 1-999 (`integerToWords`
 *  below guards each group with `if (group)` first) — index overflow past
 *  ONES/TENS is not reachable through that path, but `n` is a plain
 *  `number` with no type-level bound, so `wordAt`'s own fallback is what
 *  keeps a hypothetical bad input (or a future caller) from ever printing
 *  the literal string "undefined" into a real bill. */
export function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(wordAt(ONES, Math.floor(n / 100)) + " Hundred");
    n %= 100;
  }
  if (n >= 20) {
    parts.push(wordAt(TENS, Math.floor(n / 10)) + (n % 10 ? " " + wordAt(ONES, n % 10) : ""));
  } else if (n > 0) {
    parts.push(wordAt(ONES, n));
  }
  return parts.join(" ");
}

/** Whole rupees only (no decimals) — Indian grouping: ones/tens/hundreds,
 *  then thousand, lakh, crore, each a three-or-two-digit group. */
function integerToWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1_000);
  const rest = n % 1_000;

  const parts: string[] = [];
  if (crore) parts.push(threeDigitsToWords(crore) + " Crore");
  if (lakh) parts.push(threeDigitsToWords(lakh) + " Lakh");
  if (thousand) parts.push(threeDigitsToWords(thousand) + " Thousand");
  if (rest) parts.push(threeDigitsToWords(rest));
  return parts.join(" ");
}

/** `formatINRInWords(123456.50)` -> "Rupees One Lakh Twenty Three Thousand
 *  Four Hundred Fifty Six and Fifty Paise Only". Half-up to the paisa, same
 *  rounding `formatINR` itself uses — this is a display transform of an
 *  already-stored, already-rounded figure, never a second rounding policy. */
export function formatINRInWords(value: MoneyInput): string {
  const d = value instanceof Decimal ? value : new Decimal(value);
  if (!d.isFinite()) throw new TypeError(`formatINRInWords: not a finite amount: ${String(value)}`);

  const fixed = d.abs().toFixed(2, Decimal.ROUND_HALF_UP);
  const [wholeStr = "0", paiseStr = "00"] = fixed.split(".");
  const whole = Number(wholeStr);
  const paise = Number(paiseStr);
  const sign = d.isNegative() ? "Minus " : "";

  const rupeesWords = integerToWords(whole);
  const paiseWords = paise > 0 ? ` and ${threeDigitsToWords(paise)} Paise` : "";
  return `${sign}Rupees ${rupeesWords}${paiseWords} Only`;
}
