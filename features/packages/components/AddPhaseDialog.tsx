"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { createPhaseSchema } from "@/features/packages/schema";
import { createPhase } from "@/features/packages/actions";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";

/**
 * Add Phase (APX-10): a stage of this package with its own client-facing
 * (Allocated) and internal budget. Phases are what tasks belong to and what
 * gets billed, so a package needs at least one before it can be scheduled.
 *
 * Opened from the Budget tab, and from Add Task when the package has no phase
 * yet — `thenAddTask` sends the person straight back to Add Task afterwards,
 * so creating the missing phase does not lose their place.
 */
export function AddPhaseDialog({
  projectId,
  moduleId,
  thenAddTask,
}: {
  projectId: string;
  moduleId: string;
  thenAddTask: boolean;
}) {
  const { closeDialog, openDialog, toast } = useApp();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createPhaseSchema),
    defaultValues: { packageId: moduleId, name: "", allocatedAmount: "", internalAmount: "" },
  });

  const create = useAction(createPhase, {
    onSuccess: () => {
      toast("Phase added");
      router.refresh();
      if (thenAddTask) openDialog({ kind: "addTask", projectId, moduleId });
      else closeDialog();
    },
  });

  const onSubmit = handleSubmit((values) => create.execute(values));

  return (
    <DialogShell
      title="Add Phase"
      description={
        thenAddTask
          ? "A task must belong to a phase. Add one, and you'll go straight back to Add Task."
          : "A stage of this package. Its tasks roll up into it, and it is billed once they are done."
      }
      okLabel={create.isPending ? "Adding…" : "Add Phase"}
      okPending={create.isPending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div className="sm:col-span-2">
          <Field label="Phase Name" htmlFor="ap-name">
            <input id="ap-name" className={inputClass} placeholder="Waterproofing" {...register("name")} />
          </Field>
          {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <Field label="Allocated (₹)" htmlFor="ap-alloc" hint="What the client is charged for it.">
            <input
              id="ap-alloc"
              inputMode="decimal"
              className={inputClass}
              {...register("allocatedAmount")}
            />
          </Field>
          {errors.allocatedAmount && (
            <p className="text-xs text-destructive mt-1">{errors.allocatedAmount.message}</p>
          )}
        </div>
        <div>
          <Field label="Internal (₹)" htmlFor="ap-internal" hint="Your cost budget. Admins only.">
            <input
              id="ap-internal"
              inputMode="decimal"
              className={inputClass}
              {...register("internalAmount")}
            />
          </Field>
          {errors.internalAmount && (
            <p className="text-xs text-destructive mt-1">{errors.internalAmount.message}</p>
          )}
        </div>
        {create.result.serverError && (
          <p className="sm:col-span-2 text-[12.5px] text-destructive">{create.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
