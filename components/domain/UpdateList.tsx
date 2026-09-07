import { Project, Update } from "@/lib/types";
import { dmy, mno } from "@/lib/logic";
import { Badge } from "@/components/ui/Badge";

export function UpdateList({ project, updates }: { project: Project; updates: Update[] }) {
  return (
    <div className="flex flex-col px-5 pt-1 pb-2">
      {updates.map((u) => {
        const m = project.modules.find((x) => x.id === u.mod);
        return (
          <div
            key={u.id}
            className="relative pl-[26px] pb-[22px] pt-1 border-l-2 border-border ml-1.5 last:pb-1.5 before:content-[''] before:absolute before:-left-[7px] before:top-2 before:w-3 before:h-3 before:rounded-full before:bg-primary before:border-2 before:border-card"
          >
            <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
              <span className="font-bold text-[13.5px] tabular-nums">{dmy(u.date)}</span>
              {m && <Badge variant="outline">{mno(project, m)} {m.name}</Badge>}
              <span className="text-muted-foreground text-sm">{u.by}</span>
            </div>
            <div className="text-[13.5px] max-w-[70ch]">{u.text}</div>
            <div className="flex gap-2 mt-2.5 flex-wrap">
              {Array.from({ length: Math.min(u.photos, 4) }, (_, i) => (
                <i key={i} className="w-24 h-[72px] rounded-md bg-muted border border-border not-italic" />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
