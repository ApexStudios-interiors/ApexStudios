/**
 * The three small display formatters the app still uses from the prototype's
 * `lib/logic.ts`, which is otherwise retired (APX-67). Pure, no money: money
 * is formatted by `lib/money` (`formatINR`/`formatINRCompact`) and nowhere
 * else (AGENTS.md "Money display").
 */

/** Whole-number percentage of `a` over `b`; 0 when `b` is 0 rather than NaN. */
export function pct(a: number, b: number): number {
  return b ? Math.round((a / b) * 100) : 0;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `yyyy-MM-dd` → `06 Sep 2026`, by splitting the string on the local calendar
 * Y/M/D — never `new Date("yyyy-MM-dd")`, which parses as UTC midnight and can
 * roll the day (AGENTS.md). An empty or malformed value renders as `–`.
 */
export function dmy(s?: string | null): string {
  if (!s) return "–";
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return "–";
  return `${d} ${MON[+m - 1]} ${y}`;
}

/** Up to two initials from a display name: "Ravi Kumar" → "RK". */
export function initials(name: string): string {
  return name
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
}
