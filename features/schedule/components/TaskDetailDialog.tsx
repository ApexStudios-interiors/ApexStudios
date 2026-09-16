"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { updateTaskSchema } from "@/features/schedule/schema";
import { updateTask, setTaskProgress, getTaskForEdit, type TaskForEdit } from "@/features/schedule/actions";
import { DialogShell, Field, inputClass, textareaClass } from "@/components/ui/DialogShell";

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
  const [, startTransition] = useTransition();

  useEffect(() => {
    getTaskForEdit(taskId)
      .then((t) => {
        setCurrent(t);
        if (t) setConfirmedProgress(t.progressPct);
      })
      .catch(() => {
        toast("Could not load this task.");
        setCurrent(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const progressAction = useAction(setTaskProgress);

  function commitProgress(pct: number) {
    startTransition(async () => {
      setOptimisticProgress(pct);
      const result = await progressAction.executeAsync({ id: taskId, progressPct: pct });
      if (result?.serverError) {
        toast(result.serverError);
        // confirmedProgress stays at the old value on purpose — the
        // optimistic override reverts to it once this transition settles.
      } else {
        setConfirmedProgress(pct);
      }
    });
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
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
      okDisabled={update.isPending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Progress" hint={`${optimisticProgress}%`}>
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={optimisticProgress}
              onChange={(e) => setOptimisticProgress(+e.target.value)}
              onPointerUp={(e) => commitProgress(+e.currentTarget.value)}
              className="w-full accent-current"
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Task Name" htmlFor="td-name">
            <input id="td-name" className={inputClass} {...register("name")} />
          </Field>
          {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
        </div>
        <Field label="Start Date" htmlFor="td-start">
          <input id="td-start" type="date" className={inputClass} {...register("startDate")} />
        </Field>
        <Field label="Duration (weeks)" htmlFor="td-duration">
          <input
            id="td-duration"
            type="number"
            min={1}
            max={104}
            className={inputClass}
            {...register("durationWeeks")}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Note" htmlFor="td-note">
            <textarea id="td-note" className={textareaClass} placeholder="Optional" {...register("note")} />
          </Field>
        </div>
        {update.result.serverError && (
          <p className="col-span-2 text-[12.5px] text-destructive">{update.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
