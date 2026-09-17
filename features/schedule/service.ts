/**
 * Pure date arithmetic. No next/* imports — testable against a plain
 * connection or no connection at all (HLD §4.2, code-standards §1). This is
 * the highest-value unit-test surface in build/05-schedule-and-progress.md:
 * ADR-011 replaces the prototype's `start_week` integer with a real
 * `start_date` + `duration_weeks`, and every bug in that migration shows up
 * here first.
 *
 * Dates cross this module as `YYYY-MM-DD` strings (exactly what Postgres's
 * `date` type and PostgREST hand back) and are parsed as UTC midnight,
 * never through `new Date(str)`'s local-timezone parsing or `Date`'s local
 * getters/setters — those shift a task by a day for anyone not in UTC+0.
 * `TZ=America/New_York pnpm test` is what this build's exit criteria run
 * specifically to catch a regression here.
 */

import { todayIst } from "@/lib/dates";

const MS_PER_DAY = 86_400_000;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseUtcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`not a YYYY-MM-DD date: ${iso}`);
  }
  return new Date(Date.UTC(y, m - 1, d));
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** floor((taskStart - projectStart) / 7 days). Negative for a task that
 *  starts before the project itself does — deliberately not clamped to 0;
 *  `viewportWeeks` below widens the visible window to include it instead,
 *  because clamping would silently misplace the bar. */
export function weekIndex(taskStart: string, projectStart: string): number {
  const days = (parseUtcDate(taskStart).getTime() - parseUtcDate(projectStart).getTime()) / MS_PER_DAY;
  return Math.floor(days / 7);
}

/** The inverse of `weekIndex` — the calendar date a given week column
 *  represents, for the Gantt's own header row (the day-of-month under each
 *  week number). */
export function dateAtWeek(projectStart: string, index: number): string {
  return formatUtcDate(new Date(parseUtcDate(projectStart).getTime() + index * 7 * MS_PER_DAY));
}

/** start + duration_weeks*7 - 1 — the same formula as `tasks.end_date`'s
 *  generated column (02-lld.md §3.3). Used for previewing an end date in the
 *  task dialogs before submission; the persisted value always comes from the
 *  database's own generated column, never recomputed after a fetch. */
export function taskEndDate(start: string, durationWeeks: number): string {
  const end = new Date(parseUtcDate(start).getTime() + (durationWeeks * 7 - 1) * MS_PER_DAY);
  return formatUtcDate(end);
}

/** A task is late only once it is actually overdue AND incomplete — 100% on
 *  the due date, or after it, is on time, not late. `endDate` is the
 *  database's own generated column, read at fetch time; it is never
 *  recomputed or stored separately (01-hld.md §8.5: a stored late flag is
 *  wrong every midnight, so this is not stored at all). */
export function isLate(task: { endDate: string; progressPct: number }, today: string): boolean {
  return task.endDate < today && task.progressPct < 100;
}

export type ScheduleWindow = { from: number; to: number };

const DEFAULT_VIEWPORT_WEEKS = 14;

/**
 * Defaults to a 14-week window from the project start. If the project is
 * already under way past that window, the default shifts to one week of
 * context before today through 14 weeks from there — landing a user in week
 * 1 of a nine-month project is not useful. Either way, the window then
 * widens (never shrinks) to include every task's full extent, including a
 * task that starts before the project itself (a negative index) — widening
 * is more honest than clamping it out of view.
 */
export function viewportWeeks(
  projectStart: string,
  tasks: { startDate: string; endDate: string }[],
  today: string
): ScheduleWindow {
  let from = 0;
  let to = DEFAULT_VIEWPORT_WEEKS - 1;

  const todayIdx = weekIndex(today, projectStart);
  if (todayIdx > to) {
    from = todayIdx - 1;
    to = from + DEFAULT_VIEWPORT_WEEKS - 1;
  }

  for (const t of tasks) {
    const start = weekIndex(t.startDate, projectStart);
    const end = weekIndex(t.endDate, projectStart);
    if (start < from) from = start;
    if (end > to) to = end;
  }

  return { from, to };
}

/** Groups the visible week range into calendar-month spans for the Gantt's
 *  header row. Takes `projectStart` in addition to the build file's own
 *  shorthand signature `monthHeaders(from, to)` — a week index is meaningless
 *  without an anchor date to convert it back to a real calendar month. */
export function monthHeaders(
  projectStart: string,
  from: number,
  to: number
): { label: string; span: number }[] {
  const headers: { label: string; span: number }[] = [];
  const start = parseUtcDate(projectStart);
  let i = from;
  while (i <= to) {
    const anchor = new Date(start.getTime() + i * 7 * MS_PER_DAY);
    const month = anchor.getUTCMonth();
    const year = anchor.getUTCFullYear();
    let span = 0;
    while (i <= to) {
      const d = new Date(start.getTime() + i * 7 * MS_PER_DAY);
      if (d.getUTCMonth() !== month || d.getUTCFullYear() !== year) break;
      span++;
      i++;
    }
    headers.push({ label: `${MONTH_NAMES[month]} ${year}`, span });
  }
  return headers;
}

/**
 * Σ(duration × progress) / Σ(duration) — a 3-week task at 100% and a 1-week
 * task at 0% is 75%, not 50% (T-16). This is the SAME formula
 * features/packages/service.ts's `durationWeightedProgress` implements as a
 * pure oracle for the database trigger that actually maintains
 * `packages.progress_pct`; this copy is the one the Gantt's own per-phase
 * live percentage is computed from directly (real fetched tasks, not a
 * stored cache), which is why it lives here rather than being imported from
 * there.
 */
export function weightedProgress(tasks: { durationWeeks: number; progressPct: number }[]): number {
  const totalWeeks = tasks.reduce((sum, t) => sum + t.durationWeeks, 0);
  if (totalWeeks === 0) return 0;
  const weighted = tasks.reduce((sum, t) => sum + t.durationWeeks * t.progressPct, 0);
  return Math.round(weighted / totalWeeks);
}

/** "Today" as a YYYY-MM-DD string — the same date-only shape every other
 *  function here takes, computed once per request rather than each caller
 *  reaching for `new Date()` (and each other's local timezone) separately.
 *
 *  It is today in `Asia/Kolkata`, not in UTC: this drives the late-task flag
 *  and the Gantt's today line, both of which were a day behind between 00:00
 *  and 05:30 IST while the server (Vercel, UTC) still called it yesterday.
 *  The week arithmetic above stays UTC-based — it indexes date strings against
 *  each other and never against the clock. */
export function todayIso(): string {
  return todayIst();
}
