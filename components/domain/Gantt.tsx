"use client";

import { Fragment, useState } from "react";
import { ModuleT, Project } from "@/lib/types";
import { phTasks } from "@/lib/logic";
import { useApp } from "@/context/AppContext";
import { Icon } from "@/components/ui/Icon";
import { Empty } from "@/components/ui/Empty";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TODAY = new Date("2026-09-07");
const WEEKS = 14;

function wkDate(start: Date, i: number) {
  const d = new Date(start);
  d.setDate(d.getDate() + (i - 1) * 7);
  return d;
}

export function Gantt({ project, module }: { project: Project; module: ModuleT }) {
  const { role, openDialog, toast } = useApp();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const start = project.start ? new Date(project.start) : null;
  const nowWk = start ? Math.floor((TODAY.getTime() - start.getTime()) / (7 * 864e5)) + 1 : 0;

  if (!module.tasks.length) {
    return (
      <Empty>
        No tasks yet.{" "}
        <button
          className="underline text-foreground"
          onClick={() => openDialog({ kind: "addTask", projectId: project.id, moduleId: module.id })}
        >
          Add a task
        </button>
      </Empty>
    );
  }

  const months: { label: string; span: number }[] = [];
  if (start) {
    let i = 1;
    while (i <= WEEKS) {
      const d = wkDate(start, i);
      let n = 0;
      while (i + n <= WEEKS && wkDate(start, i + n).getMonth() === d.getMonth()) n++;
      months.push({ label: `${MON[d.getMonth()]} ${d.getFullYear()}`, span: n });
      i += n;
    }
  }

  const groups = [
    ...module.packages.map((k) => ({ id: k.id, name: k.name, tasks: phTasks(module, k) })).filter((g) => g.tasks.length),
    { id: "other", name: "General", tasks: module.tasks.filter((t) => !module.packages.some((k) => k.id === t.pkg)) },
  ].filter((g) => g.tasks.length);

  const toggle = (key: string) => {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const weekRange = Array.from({ length: WEEKS }, (_, i) => i + 1);

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[960px]" style={{ gridTemplateColumns: `280px repeat(${WEEKS}, minmax(52px,1fr))` }}>
        {start && (
          <>
            <div className="border-b border-border bg-muted/50 sticky left-0 z-[2]" />
            {months.map((mo, i) => (
              <div
                key={i}
                className="text-xs font-semibold px-2.5 py-2 border-b border-l border-border bg-muted/50 whitespace-nowrap"
                style={{ gridColumn: `span ${mo.span}` }}
              >
                {mo.label}
              </div>
            ))}
          </>
        )}
        <div className="text-[13.5px] px-4 py-2 border-b border-border text-left sticky left-0 bg-card z-[2] font-medium">
          Task
        </div>
        {weekRange.map((wk) => {
          const isNow = wk === nowWk;
          return (
            <div
              key={wk}
              className={`text-xs px-1.5 py-2 border-b border-border text-center whitespace-nowrap font-medium ${
                isNow ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {start ? (
                <>
                  <span className={`block text-sm font-bold leading-tight ${isNow ? "text-status-destructive" : "text-foreground"}`}>
                    {wkDate(start, wk).getDate()}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">W{wk}</span>
                </>
              ) : (
                `W${wk}`
              )}
            </div>
          );
        })}

        {groups.map((g) => {
          const key = module.id + ":" + g.id;
          const isClosed = closed.has(key);
          const gd = g.tasks.reduce((a, t) => a + t.d, 0);
          const gp = gd ? Math.round(g.tasks.reduce((a, t) => a + t.p * t.d, 0) / gd) : 0;
          return (
            <Fragment key={key}>
              <div
                onClick={() => toggle(key)}
                className="bg-muted/50 text-[13px] font-semibold px-2.5 py-1.5 sticky left-0 z-[1] border-b border-border flex items-center gap-1.5 whitespace-nowrap cursor-pointer select-none hover:bg-muted/80"
              >
                <span className="inline-grid place-items-center w-[18px] h-[18px] text-muted-foreground">
                  <Icon name="chevronRight" className={`w-3.5 h-3.5 transition-transform ${isClosed ? "" : "rotate-90"}`} />
                </span>
                {g.name}
                <span className="text-muted-foreground font-normal ml-2">
                  {g.tasks.length} tasks · {gp}%
                </span>
              </div>
              {weekRange.map((wk) => (
                <div key={wk} className="bg-muted/50 border-b border-border min-h-[28px]" />
              ))}

              {!isClosed &&
                g.tasks.map((t) => {
                  const idx = module.tasks.indexOf(t);
                  const late = !!start && t.p < 100 && t.w + t.d - 1 < nowWk;
                  return (
                    <Fragment key={idx}>
                      <div className="px-4 py-2.5 border-b border-border sticky left-0 bg-card z-[1] text-[13px]">
                        <div className="font-medium">{t.t}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.owner} · {t.d} wk · <b className="text-foreground font-semibold">{t.p}%</b>
                          {late && (
                            <>
                              {" · "}
                              <b className="flag">late</b>
                            </>
                          )}
                        </div>
                      </div>
                      {weekRange.map((wk) => (
                        <div key={wk} className={`relative border-b border-l border-border/60 min-h-[46px] ${wk === nowWk ? "bg-muted/60" : ""}`}>
                          {wk === t.w && (
                            <div
                              onClick={() => {
                                if (role === "client") {
                                  toast(`${t.t}: ${t.p}% complete`);
                                  return;
                                }
                                openDialog({ kind: "taskDetail", projectId: project.id, moduleId: module.id, taskIndex: idx });
                              }}
                              title={`${t.t}: ${t.p}%`}
                              className={`absolute top-[13px] h-5 rounded-md bg-primary/10 overflow-hidden cursor-pointer hover:outline-2 hover:outline-ring/40 ${
                                late ? "outline-[1.5px] outline-dashed outline-foreground outline-offset-1" : ""
                              }`}
                              style={{ left: 3, width: `calc(${t.d * 100}% - 6px)` }}
                            >
                              <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${t.p}%` }} />
                            </div>
                          )}
                        </div>
                      ))}
                    </Fragment>
                  );
                })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
