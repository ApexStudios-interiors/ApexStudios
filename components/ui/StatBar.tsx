import type { ReactNode } from "react";
import { Card } from "./Card";

export interface Stat {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  negative?: boolean;
}

export function StatBar({ stats, className = "" }: { stats: Stat[]; className?: string }) {
  return (
    <div className={`grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4 mb-5 ${className}`}>
      {stats.map((s, i) => (
        <Card key={i} className="px-[22px] py-[18px]">
          <div className="text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide">
            {s.label}
          </div>
          <div
            className={`text-[23px] font-bold tracking-tight mt-[7px] leading-tight ${s.negative ? "font-bold" : ""}`}
          >
            {s.value}
          </div>
          {s.sub != null && <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>}
        </Card>
      ))}
    </div>
  );
}
