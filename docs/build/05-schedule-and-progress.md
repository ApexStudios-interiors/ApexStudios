# Build 05 — Schedule, Tasks, the Gantt on Real Dates & Progress Rollup

> **This file is a prompt.** It carries the only deliberate data-model change to the prototype's
> UI: the Gantt stops storing week integers and starts storing real dates (ADR-011).
>
> **Depends on:** Build 04 (packages and phases on server data).
> **Blocks:** Build 09 — a phase becomes billable when its tasks reach 100%, and that flip
> happens here.
> **Branch:** `build/05-schedule`

---

## 0. Prerequisites — what a human must do outside the codebase

- [ ] **Confirm the week convention.** `02-lld.md` §3.3 defines
      `end_date = start_date + (duration_weeks * 7) - 1`, i.e. plain seven-day weeks with no
      working-day calendar and no holidays. That means a task's bar includes Sundays, and the
      "late" flag ignores public holidays. Confirm Voola accepts this for v1. A working-day
      calendar is a different feature with a holiday table behind it, and it is not in
      `01-hld.md` §2.1.
- [ ] **Confirm the drag-to-reschedule exclusion.** `02-lld.md` §8.3 excludes it deliberately:
      it is a large touch-target problem on a phone and a source of accidental data change on a
      schedule people are billing against. Get explicit agreement, because it is the first thing
      someone will ask for on seeing a Gantt chart.
- [ ] **Real project start dates.** Every week index in the Gantt is derived from
      `project.start_date`. A wrong start date shifts the entire chart. Confirm each date with
      whoever owns the project.
- [ ] **Existing schedules**, if Apex keeps them in Microsoft Project or a spreadsheet. If there
      is a real plan to import, get the file now — it changes whether Build 10 needs a task
      importer or whether tasks are entered by hand.
- [ ] **Confirm who may set task progress.** `01-hld.md` §7.1 says Admin and Site. Confirm a site
      supervisor can move a task to 100%, which is what makes a phase billable — this is a site
      user taking an action with commercial consequences, and it should be a conscious decision.

---

## 1. Objective

Tasks stored as real dates, a Gantt that is a scrolling viewport over those dates, progress
rolling up from task to package to project, and phases flipping to `billable` when their tasks
complete — with the chart looking exactly as it does today.

---

## 2. The one deliberate UI change

The prototype's `AddTaskDialog` and `TaskDetailDialog` ask for **"Start Week"** as an integer,
because `Task.w` is an index into a fixed 14-week grid.

That breaks the moment a project runs past 14 weeks, or the project start date moves — every
task silently shifts. `02-lld.md` §3.3 and ADR-011 replace it with `start_date date` +
`duration_weeks int`, and derive the column position:

```
week_index = floor((task.start_date - project.start_date) / 7)
```

So: **"Start Week" becomes a date picker.** Same dialog, same layout, same field position, one
input type changed. Everything else about the Gantt — the 14-week default viewport, the month
headers, the red today column, the phase grouping, the progress fill, the dashed late outline —
looks and behaves identically.

Call this out in the PR as the single intended visual difference, with a before/after screenshot.

---

## 3. Steps

### 3.1 Migration: `rpc_set_task_progress` and `rpc_mark_phase_complete`

**`rpc_set_task_progress(p_task_id uuid, p_pct smallint)`** — `security definer`,
`set search_path = ''`:

1. Lock the task row (`for update`).
2. `is_member_of(project_id)` and `auth_role() in ('owner','admin','site')`, else `FORBIDDEN`.
3. Reject a `p_pct` outside 0–100 (the check constraint also catches it; fail early with a clean
   error).
4. Update `progress_pct`, `updated_at`, `updated_by`.
5. Recompute the parent phase: if it has tasks and **all** are at 100, set
   `billing_status = 'billable'`; if it was `billable` and a task drops below 100, set it back to
   `unresolved` — **but only when `billing_status` is still `unresolved` or `billable`.** A phase
   already `billed` or `paid` must never be reopened by a task edit. That is the difference
   between a progress correction and a silent restatement of an issued invoice.
6. `fn_audit('task', id, 'update', before, after)`.

The package and project `progress_pct` caches are maintained by the trigger from Build 02 §4.6,
not by this function. Two writers to the same cached column is how it drifts.

**`rpc_mark_phase_complete(p_phase_id uuid)`** — admin only, and **only permitted when the phase
has zero tasks** (`02-lld.md` §5.7). Sets `manual_complete_at` and `manual_complete_by`, flips
`billing_status` to `billable`, audits. This is the "Mark Complete" button in the package
Billing tab (`docs/ui-guide.md` §6.5), and it is a human asserting billability where no schedule
exists — so it needs a name against it.

pgTAP and integration tests for both, before any UI.

### 3.2 `features/schedule/`

**`service.ts`** — pure date arithmetic, and the highest-value unit tests in this build:

```ts
weekIndex(taskStart: Date, projectStart: Date): number     // floor(diff / 7)
taskEndDate(start: Date, durationWeeks: number): Date      // start + d*7 - 1
isLate(task, today): boolean                               // end < today && progress < 100
viewportWeeks(projectStart, tasks, today): { from, to }    // default 14, widened to fit
monthHeaders(from, to): { label, span }[]
weightedProgress(tasks): number                            // Σ(d × p) / Σ(d)
```

Test the edges explicitly: a task starting **before** the project start (negative index — decide
and document whether to clamp or to widen the viewport left; widening is more honest), a task
running past the viewport, a zero-duration task (the constraint forbids it — assert the error), a
project with no tasks, and daylight-saving-free but timezone-sensitive date maths. Dates are
`date`, not `timestamptz`; parse them as calendar dates and never through the local timezone, or
a task will jump a day for a user in a different offset.

**`queries.ts`** — `getScheduleForProject`, `getScheduleForPackage`. Returns tasks grouped by
phase, with `weekIndex` and `late` computed at read time. **`late` is never stored**
(`01-hld.md` §8.5) — a stored late flag is wrong every midnight.

**`actions.ts`** — `createTask`, `updateTask`, `setTaskProgress` (`02-lld.md` §7), all
`siteAction` (owner/admin/site).

### 3.3 Refactor `Gantt.tsx`

Keep the rendering. Change the input.

- Props become `{ tasks: ScheduleTask[], projectStart: string, viewport: { from, to }, canEdit: boolean }`.
- Column position from `weekIndex`, not `task.w`.
- The 14-week grid becomes a **scrolling window** over real dates: horizontal scroll, sticky
  phase-name column, month headers spanning their weeks, today's column highlighted red as now.
  Default the viewport to 14 weeks from the project start, or to a window containing today if
  the project is under way — landing a user in week 1 of a nine-month project is not useful.
- Progress fill, dashed outline and the late flag: unchanged in appearance.
- **Virtualise past 100 tasks** (`02-lld.md` §8.3). Below that, plain rendering; measure before
  adding a virtualiser to a 20-row chart.
- **Client role:** clicking a bar shows the read-only toast, exactly as now
  (`"{task}: {progress}% complete"`). Drive it from `canEdit`, not from a role string inside the
  component — the component should not know what a role is.

### 3.4 Task dialogs

- **`AddTaskDialog`** — Phase select, Task name, Owner select (from project members), **Start
  date** (date picker), Duration in weeks. Submits `createTask`.
- **`TaskDetailDialog`** — progress slider, start date, duration, note. Submits `updateTask` and
  `setTaskProgress`.

**Optimistic progress with rollback** (`01-hld.md` §12): the slider updates immediately via
`useOptimistic`, and reverts with a toast if the action fails. Progress is the one value a
supervisor changes repeatedly on a phone with poor signal, and it is the one place optimistic UI
genuinely earns its complexity here. Do not extend optimistic updates to money or status
transitions.

### 3.5 Convert the schedule surfaces

1. **`app/projects/[projectId]/schedule/page.tsx`** — Expand all / Collapse all, one collapsible
   card per package showing `{n} tasks · {progress}%` or "No plan yet", **+ Add Task** hidden for
   the client role. Expansion state is client state; the data is server-fetched.
2. **`packages/[moduleId]/schedule/page.tsx`** — the same Gantt scoped to one package, now a
   route (Build 04 §4.4) with its own `loading.tsx`.
3. Both get a skeleton that reserves the grid's exact height, so expanding does not shift the
   page.

### 3.6 Delete the superseded prototype logic

Once both surfaces render from the database: remove `progress`, `projProgress`, `phTasks` and
`phStatus` from `lib/logic.ts`, and the `w`/`d` fields from the prototype `Task` type. Update
`lib/data.ts` only if `AppContext` still needs to compile — Builds 06–09 still read from it.

---

## 4. Tests

**Unit — the date arithmetic is where the bugs will be**
- `weekIndex` for a task on the project start date → 0; seven days later → 1; six days later → 0.
- A task starting before the project start → negative index, handled as documented.
- `taskEndDate(2026-08-24, 3)` → `2026-09-13` (21 days minus one).
- `isLate` is false at exactly 100% on an overdue task, true at 99%.
- T-16: a 3-week task at 100% + a 1-week task at 0% → **75%**, not 50%.
- Weighted progress with a single zero-duration task → the constraint rejects it upstream.
- Dates round-trip through the DTO without shifting by a day in a non-IST timezone. Run one test
  with `TZ=America/New_York` set.

**Integration**
- T-17: every task in a phase reaching 100 flips `billing_status` to `billable`.
- Dropping a task below 100 returns an `unresolved` phase to `unresolved` — and does **not**
  touch a phase that is already `billed` or `paid`.
- `rpc_mark_phase_complete` on a phase **with** tasks is refused.
- A client calling `setTaskProgress` is refused.
- A site user calling `setTaskProgress` on a project they are not a member of is refused.
- The rollup trigger updates package and project `progress_pct` in the same transaction.

**Playwright**
- *Site:* open Schedule → expand a package → click a bar → move the slider to 100 → the bar fills,
  the package percentage updates, and the phase shows as Billable in the Billing tab.
- *Client:* click a bar → read-only toast, no dialog.
- *Admin:* add a task with a date beyond the 14-week default → the viewport widens and the task
  is visible without manual scrolling.

**Visual**
Gantt screenshots in both themes against `proto-v1`, with the seed's task dates producing the
same week positions as the prototype's `w` values. That equivalence is the proof that the date
migration in `seed.sql` (Build 02 §4.9) was correct.

---

## 5. Verification — exit criteria

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:rls && pnpm test:e2e && pnpm build
TZ=America/New_York pnpm test    # date handling must be timezone-independent
```

- [ ] Move a seeded project's `start_date` forward by one week and confirm every task shifts one
      column and no dates change. That is the whole point of ADR-011 — verify it explicitly.
- [ ] A project with a 40-week schedule scrolls correctly and shows correct month headers.
- [ ] 200 seeded tasks render without a visible frame drop.
- [ ] The Gantt matches `proto-v1` visually; the only dialog difference is the date picker.
- [ ] `docs/progress-tracker.md` updated.

---

## 6. Guardrails — do not

- **Do not store `start_week`, `week_index`, `end_date` (beyond the generated column), or a
  `late` flag.** All four are derived, and three of them go stale.
- **Do not add drag-to-reschedule** without a decision on the prerequisite (§0).
- **Do not let a task edit reopen a `billed` or `paid` phase.**
- **Do not maintain `progress_pct` caches from two places.** The trigger owns them.
- **Do not put role checks inside `Gantt.tsx`.** Pass `canEdit`.
- **Do not use `Date` parsing that goes through the local timezone** for a `date` column.
- **Do not extend optimistic UI to money or to status transitions.**

---

## 7. Deliverables

- [ ] `rpc_set_task_progress` and `rpc_mark_phase_complete` with pgTAP + integration tests
- [ ] `features/schedule/` — pure date service with full edge-case tests, queries, actions
- [ ] `Gantt.tsx` on real dates with a scrolling viewport and virtualisation past 100 tasks
- [ ] `AddTaskDialog` and `TaskDetailDialog` on server actions, with optimistic progress
- [ ] Project and package schedule routes on server data, with skeletons
- [ ] Superseded helpers removed from `lib/logic.ts`
- [ ] Tests: unit date arithmetic, T-16, T-17, three Playwright journeys, visual parity
- [ ] PR documents the Start Week → date picker change with before/after screenshots
