"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { updateProjectSchema } from "@/features/projects/schema";
import { getProjectForEdit, updateProject, type ProjectForEdit } from "@/features/projects/actions";
import { PROJECT_ARCHIVED_COPY } from "@/features/projects/service";
import { DatePicker } from "@/components/shared/DatePicker";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";
import { formatINR } from "@/lib/money";
import { dmy } from "@/lib/format";

/** A money or percentage input: text, not type=number, so the value stays the
 *  exact string the schema checks (code-standards §6). */
const numericInput = `${inputClass} tabular-nums`;

/**
 * Edit Project (APX-11): name, location, target end date, contract value and
 * the per-project billing constants. Status is not here — it is its own
 * control (ProjectStatusDialog) because it goes through an audited RPC with
 * its own rules.
 *
 * The billing constants are copied onto a bill when it is created (AGENTS.md
 * billing rules), so changing one here never restates a bill already made;
 * the dialog says so. Values the database also checks against the current row
 * (target end date vs start, advance vs already recovered) come back from
 * updateProject on the field they concern.
 */
export function EditProjectDialog({ projectId }: { projectId: string }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [current, setCurrent] = useState<ProjectForEdit | null | undefined>(undefined);

  useEffect(() => {
    getProjectForEdit(projectId)
      .then(setCurrent)
      .catch(() => setCurrent(null));
  }, [projectId]);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(updateProjectSchema),
    defaultValues: { id: projectId },
  });

  useEffect(() => {
    if (!current) return;
    reset({
      id: current.id,
      name: current.name,
      location: current.location,
      targetEndDate: current.targetEndDate,
      contractValue: current.contractValue,
      gstRatePct: current.gstRatePct,
      retentionPct: current.retentionPct,
      masBillablePct: current.masBillablePct,
      tdsPct: current.tdsPct,
      mobilisationAdvance: current.mobilisationAdvance,
      mobilisationRecoveryPct: current.mobilisationRecoveryPct,
    });
  }, [current, reset]);

  const save = useAction(updateProject, {
    onSuccess: ({ data }) => {
      if (data?.status === "invalid") {
        if (data.field === "form") setError("root", { message: data.message });
        else setError(data.field, { message: data.message });
        return;
      }
      closeDialog();
      toast("Project saved");
      router.refresh();
    },
  });

  const onSubmit = handleSubmit((values) => save.execute(values));

  if (current === undefined) {
    return (
      <DialogShell title="Edit Project" okLabel="Save" okDisabled onClose={closeDialog} onOk={() => {}}>
        <p className="text-[13.5px] text-muted-foreground">Loading…</p>
      </DialogShell>
    );
  }
  if (current === null) {
    return (
      <DialogShell title="Edit Project" okLabel="Save" okDisabled onClose={closeDialog} onOk={() => {}}>
        <p className="text-[13.5px] text-destructive">
          Could not load this project. It may have been deleted; refresh the page and try again.
        </p>
      </DialogShell>
    );
  }

  const archived = current.status === "archived";
  const fieldError = (message: string | undefined) =>
    message ? <p className="text-xs text-destructive mt-1">{message}</p> : null;

  return (
    <DialogShell
      title="Edit Project"
      description={`Started ${dmy(current.startDate)}. Status is changed with the status button on the dashboard.`}
      okLabel={save.isPending ? "Saving…" : "Save"}
      okPending={save.isPending}
      okDisabled={archived || !isDirty}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {archived && <p className="sm:col-span-2 text-[13px] font-medium">{PROJECT_ARCHIVED_COPY}</p>}
        <fieldset disabled={archived} className="contents">
          <div className="sm:col-span-2">
            <Field label="Project Name" htmlFor="ep-name">
              <input id="ep-name" className={inputClass} {...register("name")} />
            </Field>
            {fieldError(errors.name?.message)}
          </div>
          <div className="sm:col-span-2">
            <Field label="Location" htmlFor="ep-location">
              <input id="ep-location" className={inputClass} {...register("location")} />
            </Field>
            {fieldError(errors.location?.message)}
          </div>
          <div>
            <Field
              label="Target End Date"
              htmlFor="ep-end"
              hint="Optional. Click the date again to clear it."
            >
              <Controller
                control={control}
                name="targetEndDate"
                render={({ field }) => (
                  <DatePicker
                    id="ep-end"
                    ref={field.ref}
                    value={field.value || undefined}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    minDate={current.startDate}
                    placeholder="Not set"
                    disabled={archived}
                  />
                )}
              />
            </Field>
            {fieldError(errors.targetEndDate?.message)}
          </div>
          <div>
            <Field
              label="Contract Value (₹)"
              htmlFor="ep-contract"
              hint="What the client sees as the project's value."
            >
              <input
                id="ep-contract"
                inputMode="decimal"
                className={numericInput}
                {...register("contractValue")}
              />
            </Field>
            {fieldError(errors.contractValue?.message)}
          </div>

          <div className="sm:col-span-2 pt-1">
            <h3 className="text-[13.5px] font-semibold">Billing constants</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Copied onto each bill when it is created — a change applies to the next bill, never to one
              already made.
            </p>
          </div>
          <div>
            <Field label="GST %" htmlFor="ep-gst">
              <input id="ep-gst" inputMode="decimal" className={numericInput} {...register("gstRatePct")} />
            </Field>
            {fieldError(errors.gstRatePct?.message)}
          </div>
          <div>
            <Field label="Retention %" htmlFor="ep-retention">
              <input
                id="ep-retention"
                inputMode="decimal"
                className={numericInput}
                {...register("retentionPct")}
              />
            </Field>
            {fieldError(errors.retentionPct?.message)}
          </div>
          <div>
            <Field
              label="Material at site billable %"
              htmlFor="ep-mas"
              hint="MAS: how much of delivered material is billed before it is used."
            >
              <input
                id="ep-mas"
                inputMode="decimal"
                className={numericInput}
                {...register("masBillablePct")}
              />
            </Field>
            {fieldError(errors.masBillablePct?.message)}
          </div>
          <div>
            <Field label="TDS %" htmlFor="ep-tds">
              <input id="ep-tds" inputMode="decimal" className={numericInput} {...register("tdsPct")} />
            </Field>
            {fieldError(errors.tdsPct?.message)}
          </div>
          <div>
            <Field
              label="Mobilisation advance (₹)"
              htmlFor="ep-mob"
              hint={`${formatINR(current.mobilisationRecovered)} recovered on bills so far.`}
            >
              <input
                id="ep-mob"
                inputMode="decimal"
                className={numericInput}
                {...register("mobilisationAdvance")}
              />
            </Field>
            {fieldError(errors.mobilisationAdvance?.message)}
          </div>
          <div>
            <Field label="Advance recovery % per bill" htmlFor="ep-mob-pct">
              <input
                id="ep-mob-pct"
                inputMode="decimal"
                className={numericInput}
                {...register("mobilisationRecoveryPct")}
              />
            </Field>
            {fieldError(errors.mobilisationRecoveryPct?.message)}
          </div>
        </fieldset>
        {(errors.root?.message ?? save.result.serverError) && (
          <p className="sm:col-span-2 text-[12.5px] text-destructive">
            {errors.root?.message ?? save.result.serverError}
          </p>
        )}
      </form>
    </DialogShell>
  );
}
