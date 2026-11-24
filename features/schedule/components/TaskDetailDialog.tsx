"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { TASK_NAME_MAX, TASK_NOTE_MAX, updateTaskSchema } from "@/features/schedule/schema";
import { updateTask, setTaskProgress, getTaskForEdit, type TaskForEdit } from "@/features/schedule/actions";
import { DatePicker } from "@/components/shared/DatePicker";
import { DialogShell, Field, inputClass, textareaClass } from "@/components/ui/DialogShell";
import { Button } from "@/components/ui/button";

/** The progress quick picks under the slider. */
const PROGRESS_PICKS = [0, 25, 50, 75, 100];

/**
 * build/05-schedule-and-progress.md §3.4: progress slider, start date,
 * duration, note. Submits `updateTask` (plain fields) and `setTaskProgress`
 * (its own action, since it alone can flip a phase's `billing_status`).
 *
 * Optimistic progress with rollback (01-hld.md §12) — the ONE place in this
 * build optimistic UI is used: `commitProgress` updates the slider instantly
 * via `useOptimistic`, fires `setTaskProgress` on release (not on every drag
 * tick — this is the value a supervisor changes most often, often on a phone
 * with poor signal, and firing a request per pixel would be worse, not
 * better), and on failure leaves `confirmedProgress` untouched so the
 * optimistic value reverts to the last known-good one once the transition
 * settles, with a toast explaining why.
 */
export function TaskDetailDialog({ taskId }: { projectId: string; moduleId: string; taskId: string }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [current, setCurrent] = useState<TaskForEdit | null | undefined>(undefined);
  const [confirmedProgress, setConfirmedProgress] = useState(0);
  const [optimisticProgress, setOptimisticProgress] = useOptimistic(confirmedProgress);
  /** The slider's position while it is being moved, before it is committed. */
  const [draft, setDraft] = useState<number | null>(null);
  const shownProgress = draft ?? optimisticProgress;
  const [, startTransition] = useTransition();

  useEffect(() => {
    getTaskForEdit(taskId)
      .then((t) => {
        setCurrent(t);
        if (t) setConfirmedProgress(t.progressPct);
      })
      .catch(() => {
        toast("Could not load this task.", "error");
        setCurrent(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const progressAction = useAction(setTaskProgress);

  // APX-47: arrow keys / Page Up / Home on the slider used to move it without
  // ever saving. A keyboard change now commits after a short pause (so ten
  // presses are one request, not ten), and leaving the slider commits at once.
  const keyCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommitted = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (keyCommitTimer.current) clearTimeout(keyCommitTimer.current);
    },
    []
  );
  const commitIfChanged = (pct: number) => {
    if (keyCommitTimer.current) clearTimeout(keyCommitTimer.current);
    keyCommitTimer.current = null;
    if (pct === (lastCommitted.current ?? confirmedProgress)) {
      setDraft(null);
      return;
    }
    commitProgress(pct);
  };

  function commitProgress(pct: number) {
    lastCommitted.current = pct;
    startTransition(async () => {
      setOptimisticProgress(pct);
      // A transition update: the draft gives way to the optimistic value only
      // when this settles, so the slider never flickers back mid-save.
      setDraft(null);
      const result = await progressAction.executeAsync({ id: taskId, progressPct: pct });
      if (result?.serverError) {
        toast(result.serverError, "error");
        lastCommitted.current = null;
        // confirmedProgress stays at the old value on purpose — the
        // optimistic override reverts to it once this transition settles.
      } else {
        setConfirmedProgress(pct);
      }
    });
  }

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(updateTaskSchema),
    defaultValues: { id: taskId },
  });

  useEffect(() => {
    if (!current) return;
    reset({
      id: current.id,
      name: current.name,
      startDate: current.startDate,
      durationWeeks: current.durationWeeks,
      note: current.note ?? "",
    });
  }, [current, reset]);

  const update = useAction(updateTask, {
    onSuccess: () => {
      closeDialog();
      toast("Saved");
      router.refresh();
    },
  });

  const onSubmit = handleSubmit((values) => update.execute(values));

  if (current === undefined) {
    return (
      <DialogShell title="Task" okLabel="Save" okDisabled onClose={closeDialog} onOk={() => {}}>
        <p className="text-[13.5px] text-muted-foreground">Loading…</p>
      </DialogShell>
    );
  }
  if (current === null) return null;

  return (
    <DialogShell
      title={current.name}
      okLabel={update.isPending ? "Saving…" : "Save"}
      okPending={update.isPending}
      dirty={isDirty}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div className="sm:col-span-2">
          <Field
            label="Progress"
            htmlFor="td-progress"
            hint={`${shownProgress}% · Saves immediately${progressAction.isPending ? " — saving…" : ""}`}
          >
            <input
              id="td-progress"
              type="range"
              min={0}
              max={100}
              step={10}
              value={shownProgress}
              aria-valuetext={`${shownProgress}%`}
              onChange={(e) => setDraft(+e.target.value)}
              onPointerUp={(e) => commitIfChanged(+e.currentTarget.value)}
              onKeyUp={(e) => {
                const value = +e.currentTarget.value;
                if (keyCommitTimer.current) clearTimeout(keyCommitTimer.current);
                keyCommitTimer.current = setTimeout(() => commitIfChanged(value), 700);
              }}
              onBlur={(e) => commitIfChanged(+e.currentTarget.value)}
              className="w-full accent-current"
            />
            {/* Quick picks — the same save as releasing the slider
                (commitProgress: optimistic, rolled back on failure). The
                mobile app's task sheet offers the same five. */}
            <div className="flex gap-1.5 mt-2" role="group" aria-label="Set progress">
              {PROGRESS_PICKS.map((pct) => (
                <Button
                  key={pct}
                  type="button"
                  size="sm"
                  variant={shownProgress === pct ? "primary" : "default"}
                  aria-pressed={shownProgress === pct}
                  className="flex-1 tabular-nums"
                  disabled={progressAction.isPending}
                  onClick={() => commitIfChanged(pct)}
                >
                  {pct}%
                </Button>
              ))}
            </div>
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Task Name" htmlFor="td-name" error={errors.name?.message}>
            <input
              id="td-name"
              className={inputClass}
              maxLength={TASK_NAME_MAX}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "td-name-error" : undefined}
              {...register("name")}
            />
          </Field>
        </div>
        <Field label="Start Date" htmlFor="td-start" error={errors.startDate?.message}>
          <Controller
            control={control}
            name="startDate"
            render={({ field }) => (
              <DatePicker
                id="td-start"
                ref={field.ref}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                required
              />
            )}
          />
        </Field>
        <Field label="Duration (weeks)" htmlFor="td-duration" error={errors.durationWeeks?.message}>
          <input
            id="td-duration"
            type="number"
            inputMode="numeric"
            min={1}
            max={104}
            className={inputClass}
            aria-invalid={!!errors.durationWeeks}
            aria-describedby={errors.durationWeeks ? "td-duration-error" : undefined}
            {...register("durationWeeks")}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Note" htmlFor="td-note" error={errors.note?.message}>
            <textarea
              id="td-note"
              className={textareaClass}
              placeholder="Optional"
              maxLength={TASK_NOTE_MAX}
              {...register("note")}
            />
          </Field>
        </div>
        {update.result.serverError && (
          <p className="sm:col-span-2 text-[12.5px] text-destructive">{update.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
