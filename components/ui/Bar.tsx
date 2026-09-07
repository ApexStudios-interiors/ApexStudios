import { pct } from "@/lib/logic";

/** Ratio progress bar with a percentage label; flags values over 100%. */
export function Bar({ value, of, size = "md" }: { value: number; of: number; size?: "sm" | "md" }) {
  if (!of) {
    return (
      <div className="flex items-center gap-2.5">
        <div className="progress-track flex-1 min-w-[90px]">
          <i style={{ width: 0 }} />
        </div>
        <span className="text-xs text-muted-foreground w-8 text-right">–</span>
      </div>
    );
  }
  const v = pct(value, of);
  const over = v > 100;
  return (
    <div className="flex items-center gap-2.5">
      <div className={`progress-track flex-1 ${size === "sm" ? "min-w-[70px]" : "min-w-[90px]"}`}>
        <i className={over ? "over" : ""} style={{ width: `${Math.min(100, v)}%` }} />
      </div>
      <span className="text-xs text-muted-foreground text-right whitespace-nowrap">
        {v}%{over && <b className="flag">over</b>}
      </span>
    </div>
  );
}
