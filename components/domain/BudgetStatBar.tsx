import { type Stat, StatBar } from "@/components/ui/StatBar";
import { pct } from "@/lib/logic";
import { formatINRCompact } from "@/lib/money";

/**
 * `role` is the discriminated-union tag every feature's queries.ts produces
 * ("money" covers owner and admin alike — D8), not the raw session role, so
 * this component takes exactly the shape its data layer already returns.
 * Money renders with `formatINRCompact` (build/04-projects-packages-phases.md
 * §4.3): the one sanctioned visual difference from the prototype's `fmtS` is
 * the `.00` on values under a lakh.
 */
export function BudgetStatBar({
  role,
  alloc,
  int,
  c,
  prog,
  extraStats = [],
}: {
  role: "money" | "client" | "site";
  alloc: number;
  int: number;
  c: number;
  prog: number;
  extraStats?: Stat[];
}) {
  if (role === "money") {
    const rem = int - c;
    const stats: Stat[] = [
      { label: "Allocated Budget", value: formatINRCompact(alloc), sub: "Client price, ex GST" },
      {
        label: "Internal Budget",
        value: formatINRCompact(int),
        sub: `Margin ${formatINRCompact(alloc - int)} · ${pct(alloc - int, alloc)}%`,
      },
      { label: "Committed", value: formatINRCompact(c), sub: `${pct(c, int)}% of internal` },
      {
        label: "Remaining",
        value: (
          <>
            {formatINRCompact(rem)}
            {rem < 0 && <b className="flag">over</b>}
          </>
        ),
        sub: "Internal minus committed",
        negative: rem < 0,
      },
      { label: "Progress", value: `${prog}%`, sub: "Weighted by task duration" },
    ];
    return <StatBar stats={stats} />;
  }

  if (role === "client") {
    const stats: Stat[] = [
      { label: "Contract Value", value: formatINRCompact(alloc), sub: "Ex GST" },
      { label: "Work Progress", value: `${prog}%`, sub: "Weighted by task duration" },
      ...extraStats,
    ];
    return <StatBar stats={stats} />;
  }

  return null;
}
