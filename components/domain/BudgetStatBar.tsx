import { type Stat, StatBar } from "@/components/ui/StatBar";
import { fmtS, isClientRole, isMoney, pct } from "@/lib/logic";
import type { Role } from "@/lib/types";

export function BudgetStatBar({
  role,
  alloc,
  int,
  c,
  prog,
  extraStats = [],
}: {
  role: Role;
  alloc: number;
  int: number;
  c: number;
  prog: number;
  extraStats?: Stat[];
}) {
  const money = isMoney(role);
  const client = isClientRole(role);

  if (money) {
    const rem = int - c;
    const stats: Stat[] = [
      { label: "Allocated Budget", value: fmtS(alloc), sub: "Client price, ex GST" },
      {
        label: "Internal Budget",
        value: fmtS(int),
        sub: `Margin ${fmtS(alloc - int)} · ${pct(alloc - int, alloc)}%`,
      },
      { label: "Committed", value: fmtS(c), sub: `${pct(c, int)}% of internal` },
      {
        label: "Remaining",
        value: (
          <>
            {fmtS(rem)}
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

  if (client) {
    const stats: Stat[] = [
      { label: "Contract Value", value: fmtS(alloc), sub: "Ex GST" },
      { label: "Work Progress", value: `${prog}%`, sub: "Weighted by task duration" },
      ...extraStats,
    ];
    return <StatBar stats={stats} />;
  }

  return null;
}
