import { ReactNode } from "react";
import { Card } from "./Card";

export interface Stat {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  negative?: boolean;
}

export function StatBar({ stats, className = "" }: { stats: Stat[]; className?: string }) {
  return (
    <Card className={`flex flex-wrap ${className}`}>
      {stats.map((s, i) => (
        <div
          key={i}
          className="flex-1 min-w-[170px] px-[22px] py-[18px] border-r border-b border-border last:border-r-0"
        >
          <div className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide">
            {s.label}
          </div>
          <div className={`text-[23px] font-bold tracking-tight mt-[7px] leading-tight ${s.negative ? "font-bold" : ""}`}>
            {s.value}
          </div>
          {s.sub != null && <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>}
        </div>
      ))}
    </Card>
  );
}
