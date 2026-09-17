"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { createTaskSchema } from "@/features/schedule/schema";
import { createTask, getOwnerOptions, getPhaseOptions } from "@/features/schedule/actions";
import { DatePicker } from "@/components/shared/DatePicker";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

  // `items` lets the closed trigger show a NAME rather than the raw UUID.
  // Owner has a `null` item because "To assign" is a real choice a user can
  // go back to; Phase has none because its empty option was only a placeholder.
  const phaseItems = useMemo(() => (phases ?? []).map((p) => ({ value: p.id, label: p.name })), [phases]);
  const ownerItems = useMemo(
    () => [
      { value: null, label: owners ? "To assign" : "Loading…" },
      ...(owners ?? []).map((o) => ({ value: o.id, label: o.name })),
    ],
    [owners]
  );

  const {
    register,
    control,
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
      okPending={create.isPending}
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
            {/* The form keeps `""` as the empty value — createTaskSchema's
                z.uuid() still rejects it with the same message — and Base UI
                gets `null`, its own "no selection". */}
            <Controller
              control={control}
              name="phaseId"
              render={({ field }) => (
                <Select
                  items={phaseItems}
                  disabled={!phases}
                  // null until options load: no items means no label, and a
                  // set id would print as a raw UUID.
                  value={phases ? field.value || null : null}
                  onValueChange={(value: string | null) => field.onChange(value ?? "")}
                  onOpenChange={(open) => {
                    if (!open) field.onBlur();
                  }}
                >
                  <SelectTrigger id="at-phase" ref={field.ref} className="h-9 w-full text-[13.5px]">
                    <SelectValue placeholder={phases ? "Select a phase" : "Loading…"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {phaseItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          {errors.phaseId && <p className="text-xs text-destructive mt-1">{errors.phaseId.message}</p>}
        </div>
        <div className="col-span-2">
          <Field label="Owner" htmlFor="at-owner">
            {/* null item -> "" -> createTaskSchema's own "" -> undefined transform. */}
            <Controller
              control={control}
              name="ownerProfileId"
              render={({ field }) => (
                <Select
                  items={ownerItems}
                  disabled={!owners}
                  value={owners ? field.value || null : null}
                  onValueChange={(value: string | null) => field.onChange(value ?? "")}
                  onOpenChange={(open) => {
                    if (!open) field.onBlur();
                  }}
                >
                  <SelectTrigger id="at-owner" ref={field.ref} className="h-9 w-full text-[13.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {ownerItems.map((item) => (
                        <SelectItem key={item.value ?? "unassigned"} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        </div>
        <Field label="Start Date" htmlFor="at-start">
          <Controller
            control={control}
            name="startDate"
            render={({ field }) => (
              <DatePicker
                id="at-start"
                ref={field.ref}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                required
              />
            )}
          />
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
