/**
 * Quantities (stock on hand, request quantities) — not money, so not
 * lib/money's formatINR. Indian digit grouping like the money formatters, and
 * up to the 3 decimal places a quantity is stored at (`numeric(14,3)`), with
 * no trailing zeros: 1,200 · 12.5 · 0.125.
 *
 * The shared quantity formatter eslint.config.mjs's toLocaleString exemption
 * points to. New code uses this; the two exempt tables can move to it later.
 */
const formatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

export function formatQty(n: number): string {
  return formatter.format(n);
}
