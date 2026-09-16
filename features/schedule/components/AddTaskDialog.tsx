"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { createTaskSchema } from "@/features/schedule/schema";
import { createTask, getOwnerOptions, getPhaseOptions } from "@/features/schedule/actions";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";

/**
 * build/05-schedule-and-progress.md §3.4 and §2, in full: "Start Week"
 * becomes a date picker — same dialog, same layout, same field position, one
 * input type changed. Phase and Owner are now real dropdowns (schema FKs, not
 * the prototype's free-text "Gang, vendor or client" owner field, which
 * can name an outside party a real `owner_profile_id` cannot — a vendor
 * name is not representable now, the same class of gap Build 04 found for
 * package leads).
 */
export function AddTaskDialog({ moduleId }: { projectId: string; moduleId: string }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [phases, setPhases] = useState<{ id: string; name: string }[] | null>(null);
  const [owners, setOwners] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    getPhaseOptions(moduleId)
      .then(setPhases)
      .catch(() => toast("Could not load phases."));
    getOwnerOptions()
      .then(setOwners)
      .catch(() => toast("Could not load staff."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    // No explicit generic — ownerProfileId's "" -> undefined transform gives
    // the schema's input and output types different shapes for that field,
    // the same reason AddModuleDialog's own useForm skips one.
    resolver: zodResolver(createTaskSchema),
    defaultValues: { phaseId: "", name: "", ownerProfileId: "", startDate: "", durationWeeks: 2 },
  });

  const create = useAction(createTask, {
    onSuccess: () => {
      closeDialog();
      toast("Task added");
      router.refresh();
    },
  });

  const onSubmit = handleSubmit((values) => create.execute(values));

  return (
    <DialogShell
      title="Add Task"
      okLabel={create.isPending ? "Adding…" : "Add"}
      okDisabled={create.isPending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Task" htmlFor="at-name">
            <input
              id="at-name"
              className={inputClass}
              placeholder="Coping stone fixing"
              {...register("name")}
            />
          </Field>
          {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
        </div>
        <div className="col-span-2">
          <Field label="Phase" htmlFor="at-phase">
            <select id="at-phase" className={inputClass} disabled={!phases} {...register("phaseId")}>
              <option value="">{phases ? "Select a phase" : "Loading…"}</option>
              {phases?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          {errors.phaseId && <p className="text-xs text-destructive mt-1">{errors.phaseId.message}</p>}
        </div>
        <div className="col-span-2">
          <Field label="Owner" htmlFor="at-owner">
            <select id="at-owner" className={inputClass} disabled={!owners} {...register("ownerProfileId")}>
              <option value="">{owners ? "To assign" : "Loading…"}</option>
              {owners?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Start Date" htmlFor="at-start">
          <input id="at-start" type="date" className={inputClass} {...register("startDate")} />
        </Field>
        {errors.startDate && <p className="text-xs text-destructive mt-1">{errors.startDate.message}</p>}
        <Field label="Duration (weeks)" htmlFor="at-duration">
          <input
            id="at-duration"
            type="number"
            min={1}
            max={104}
            className={inputClass}
            {...register("durationWeeks")}
          />
        </Field>
        {errors.durationWeeks && (
          <p className="text-xs text-destructive mt-1">{errors.durationWeeks.message}</p>
        )}
        {create.result.serverError && (
          <p className="col-span-2 text-[12.5px] text-destructive">{create.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
