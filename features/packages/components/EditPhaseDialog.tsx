"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { updatePhaseSchema } from "@/features/packages/schema";
import { getPhaseForEdit, updatePhase, type PhaseForEdit } from "@/features/packages/actions";
import { PHASE_BILLED_COPY } from "@/features/packages/service";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";

/**
 * Edit Phase (APX-10): name, allocated and internal budget, with the same
 * optimistic-concurrency check as Edit Package (a hidden `updatedAt`; someone
 * else's save in between is a CONFLICT, never silently overwritten). A phase
 * already on a bill shows Allocated locked, with the reason in plain sight
 * (D62); the server refuses a change to it regardless.
 */
export function EditPhaseDialog({ phaseId }: { phaseId: string }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [current, setCurrent] = useState<PhaseForEdit | null | undefined>(undefined);

  useEffect(() => {
    getPhaseForEdit(phaseId)
      .then(setCurrent)
      .catch(() => setCurrent(null));
  }, [phaseId]);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(updatePhaseSchema),
    defaultValues: { id: phaseId, updatedAt: "" },
  });

  useEffect(() => {
    if (!current) return;
    reset({
      id: current.id,
      name: current.name,
      allocatedAmount: current.allocatedAmount,
      internalAmount: current.internalAmount,
      updatedAt: current.updatedAt,
    });
  }, [current, reset]);

  const update = useAction(updatePhase, {
    onSuccess: ({ data }) => {
      if (data?.status === "invalid") {
        setError(data.field, { message: data.message });
        return;
      }
      closeDialog();
      toast("Phase saved");
      router.refresh();
    },
  });

  // A billed phase never sends Allocated, so an unchanged value cannot trip
  // the lock either.
  const onSubmit = handleSubmit((values) =>
    update.execute(current?.billed ? { ...values, allocatedAmount: undefined } : values)
  );

  if (current === undefined) {
    return (
      <DialogShell title="Edit Phase" okLabel="Save" okDisabled onClose={closeDialog} onOk={() => {}}>
        <p className="text-[13.5px] text-muted-foreground">Loading…</p>
      </DialogShell>
    );
  }
  if (current === null) {
    return (
      <DialogShell title="Edit Phase" okLabel="Save" okDisabled onClose={closeDialog} onOk={() => {}}>
        <p className="text-[13.5px] text-destructive">
          Could not load this phase. It may have been removed; refresh the page and try again.
        </p>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      title="Edit Phase"
      okLabel={update.isPending ? "Saving…" : "Save"}
      okPending={update.isPending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <input type="hidden" {...register("updatedAt")} />
        <div className="sm:col-span-2">
          <Field label="Phase Name" htmlFor="ep-name">
            <input id="ep-name" className={inputClass} {...register("name")} />
          </Field>
          {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <Field label="Allocated (₹)" htmlFor="ep-alloc">
            <input
              id="ep-alloc"
              inputMode="decimal"
              className={`${inputClass} disabled:opacity-60`}
              disabled={current.billed}
              aria-describedby={current.billed ? "ep-alloc-locked" : undefined}
              {...register("allocatedAmount")}
            />
          </Field>
          {current.billed && (
            <p id="ep-alloc-locked" className="text-xs text-muted-foreground mt-1">
              {PHASE_BILLED_COPY}
            </p>
          )}
          {errors.allocatedAmount && (
            <p className="text-xs text-destructive mt-1">{errors.allocatedAmount.message}</p>
          )}
        </div>
        <div>
          <Field label="Internal (₹)" htmlFor="ep-internal">
            <input
              id="ep-internal"
              inputMode="decimal"
              className={inputClass}
              {...register("internalAmount")}
            />
          </Field>
          {errors.internalAmount && (
            <p className="text-xs text-destructive mt-1">{errors.internalAmount.message}</p>
          )}
        </div>
        {update.result.serverError && (
          <p className="sm:col-span-2 text-[12.5px] text-destructive">{update.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
