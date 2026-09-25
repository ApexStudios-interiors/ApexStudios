"use client";

import { Fragment, useMemo, useState } from "react";
import type { SchedulePhase } from "@/features/schedule/queries";
import { dateAtWeek, todayIso, weekIndex } from "@/features/schedule/service";
import { useApp } from "@/context/AppContext";
import { Icon } from "@/components/ui/Icon";
import { Empty } from "@/components/ui/Empty";

/**
 * On real dates now (ADR-011, build/05-schedule-and-progress.md). Keeps the
 * rendering, changes the input: column position comes from `weekIndex`
 * (server-computed per task, in `phases[].tasks[].weekIndexStart`), not a
 * `task.w` index into a fixed 14-week grid, and the grid is a scrolling
 * window over `viewport` instead of always exactly 14 columns.
 *
 * Props deviate from the build file's own shorthand
 * (`{ tasks, projectStart, viewport, canEdit }`) in two ways, both because
 * `features/schedule/queries.ts` already computes the shape this needs:
 * `phases` arrives pre-grouped (the same grouping this component always did
 * internally, now done once in the query instead of twice), and
 * `monthHeaders` arrives pre-computed rather than re-derived here.
 *
 * `canEdit`, not a role: this component has no idea what a role is. The
 * click behavior it drives (open the real dialog vs. a read-only toast) is
 * exactly what build/05 §3.3 requires driven by `canEdit` instead.
 *
 * No virtualisation yet: build/05 §3.3 says to measure before adding one to
 * a 20-row chart, and the largest seeded package has 13 tasks. The threshold
 * this needs revisiting at is 100 tasks in one package's Gantt — search this
 * comment when that day comes.
 */
export function Gantt({
  projectId,
  packageId,
  phases,
  projectStart,
  viewport,
  monthHeaders,
  canEdit,
  collapseSignal,
}: {
  projectId: string;
  packageId: string;
  phases: SchedulePhase[];
  projectStart: string;
  viewport: { from: number; to: number };
  monthHeaders: { label: string; span: number }[];
  canEdit: boolean;
  /**
   * An Expand all / Collapse all instruction from whatever renders this
   * chart. `epoch` changes on every press, so pressing the same button twice
   * still applies; `collapsed` is which way. Optional — the standalone
   * per-package Schedule tab has no such buttons and passes nothing.
   */
  collapseSignal?: { epoch: number; collapsed: boolean };
}) {
  const { openDialog, toast } = useApp();
  const [closed, setClosed] = useState<Set<string>>(() =>
    collapseSignal?.collapsed ? new Set(phases.map((p) => p.id)) : new Set()
  );
  // The signal is applied by adjusting state DURING render, not in an
  // effect. An effect keyed on the prop would re-run on its own schedule and
  // stamp over a phase the user collapsed by hand afterwards; this reacts to
  // the press exactly once, so per-row toggling keeps working in between.
  const [seenEpoch, setSeenEpoch] = useState(collapseSignal?.epoch ?? 0);
  if (collapseSignal && collapseSignal.epoch !== seenEpoch) {
    setSeenEpoch(collapseSignal.epoch);
    setClosed(collapseSignal.collapsed ? new Set(phases.map((p) => p.id)) : new Set());
  }

  const today = useMemo(() => todayIso(), []);
  const todayWeek = weekIndex(today, projectStart);
  const weeks = useMemo(
    () => Array.from({ length: viewport.to - viewport.from + 1 }, (_, i) => viewport.from + i),
    [viewport.from, viewport.to]
  );

  if (!phases.length) {
    return (
      <Empty>
        No tasks yet.{" "}
        {canEdit && (
          <button
            className="underline text-foreground"
            onClick={() => openDialog({ kind: "addTask", projectId, moduleId: packageId })}
          >
            Add a task
          </button>
        )}
      </Empty>
    );
  }

  const toggle = (key: string) => {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[960px]"
        style={{ gridTemplateColumns: `280px repeat(${weeks.length}, minmax(52px,1fr))` }}
      >
        <div className="border-b border-border bg-muted/50 sticky left-0 z-[2]" />
        {monthHeaders.map((mo, i) => (
          <div
            key={i}
            className="text-xs font-semibold px-2.5 py-2 border-b border-l border-border bg-muted/50 whitespace-nowrap"
            style={{ gridColumn: `span ${mo.span}` }}
          >
            {mo.label}
          </div>
        ))}

        <div className="text-[13.5px] px-4 py-2 border-b border-border text-left sticky left-0 bg-card z-[2] font-medium">
          Task
        </div>
        {weeks.map((wk) => {
          const isNow = wk === todayWeek;
          const dayOfMonth = Number(dateAtWeek(projectStart, wk).slice(-2));
          return (
            <div
              key={wk}
              className={`text-xs px-1.5 py-2 border-b border-border text-center whitespace-nowrap font-medium ${
                isNow ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <span
                className={`block text-sm font-bold leading-tight ${isNow ? "text-status-destructive" : "text-foreground"}`}
              >
                {dayOfMonth}
              </span>
              <span className="block text-[11px] text-muted-foreground">W{wk + 1}</span>
            </div>
          );
        })}

        {phases.map((ph) => {
          const isClosed = closed.has(ph.id);
          return (
            <Fragment key={ph.id}>
              <div
                onClick={() => toggle(ph.id)}
                className="bg-muted/50 text-[13px] font-semibold px-2.5 py-1.5 sticky left-0 z-[1] border-b border-border flex items-center gap-1.5 whitespace-nowrap cursor-pointer select-none hover:bg-muted/80"
              >
                <span className="inline-grid place-items-center w-[18px] h-[18px] text-muted-foreground">
                  <Icon
                    name="chevronRight"
                    className={`w-3.5 h-3.5 transition-transform ${isClosed ? "" : "rotate-90"}`}
                  />
                </span>
                {ph.name}
                <span className="text-muted-foreground font-normal ml-2">
                  {ph.tasks.length} tasks · {ph.progressPct}%
                </span>
              </div>
              {weeks.map((wk) => (
                <div key={wk} className="bg-muted/50 border-b border-border min-h-[28px]" />
              ))}

              {!isClosed &&
                ph.tasks.map((t) => (
                  <Fragment key={t.id}>
                    <div className="px-4 py-2.5 border-b border-border sticky left-0 bg-card z-[1] text-[13px]">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.ownerName ?? "To assign"} · {t.durationWeeks} wk ·{" "}
                        <b className="text-foreground font-semibold">{t.progressPct}%</b>
                        {t.late && (
                          <>
                            {" · "}
                            <b className="flag">late</b>
                          </>
                        )}
                      </div>
                    </div>
                    {weeks.map((wk) => (
                      <div
                        key={wk}
                        // z-10 only on the bar's own starting cell: a task
                        // longer than one week overflows its cell's bounds
                        // (`width: calc(N*100% - 6px)` below), and every week
                        // cell here is `position: relative` with an implicit
                        // z-index, so later cells in DOM order painted above
                        // earlier ones — the overflow rendered correctly but
                        // silently swallowed every click and hover past the
                        // first week (confirmed live via elementFromPoint;
                        // no pixel differs, so no screenshot ever caught it).
                        // Pre-existing since Build 01's prototype, found only
                        // by actually clicking a multi-week bar for this
                        // build's own Playwright journeys.
                        className={`relative border-b border-l border-border/60 min-h-[46px] ${wk === todayWeek ? "bg-muted/60" : ""} ${wk === t.weekIndexStart ? "z-10" : ""}`}
                      >
                        {wk === t.weekIndexStart && (
                          <div
                            onClick={() => {
                              if (!canEdit) {
                                toast(`${t.name}: ${t.progressPct}% complete`);
                                return;
                              }
                              openDialog({
                                kind: "taskDetail",
                                projectId,
                                moduleId: packageId,
                                taskId: t.id,
                              });
                            }}
                            title={`${t.name}: ${t.progressPct}%`}
                            className={`absolute top-[13px] h-5 rounded-md bg-primary/10 overflow-hidden cursor-pointer hover:outline-2 hover:outline-ring/40 ${
                              t.late
                                ? "outline-[1.5px] outline-dashed outline-foreground outline-offset-1"
                                : ""
                            }`}
                            style={{ left: 3, width: `calc(${t.durationWeeks * 100}% - 6px)` }}
                          >
                            <div
                              className="absolute inset-y-0 left-0 bg-primary"
                              style={{ width: `${t.progressPct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </Fragment>
                ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
