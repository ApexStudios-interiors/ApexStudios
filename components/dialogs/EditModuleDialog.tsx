"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { updatePackageSchema } from "@/features/packages/schema";
import { updatePackage, getPackageForEdit, getStaffOptions, type PackageForEdit } from "@/features/packages/actions";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";

const STATUSES = [
  { value: "not_started", label: "Not started" },
  { value: "design", label: "Design" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
] as const;

/**
 * build/04-projects-packages-phases.md §4.5: react-hook-form + the same
 * schema `updatePackage` parses, with a hidden `updatedAt` field for the
 * optimistic-concurrency check. The prototype read its current values out of
 * `AppContext`'s mock data; a real package (especially one created since this
 * build) needs a real fetch instead — `getPackageForEdit` — since the mock
 * store has nothing for it.
 */
export function EditModuleDialog({ moduleId }: { projectId: string; moduleId: string }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [current, setCurrent] = useState<PackageForEdit | null | undefined>(undefined);
  const [staff, setStaff] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    getPackageForEdit(moduleId)
      .then(setCurrent)
      .catch(() => {
        toast("Could not load this package.");
        setCurrent(null);
      });
    getStaffOptions()
      .then(setStaff)
      .catch(() => toast("Could not load staff."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    // No explicit generic — see AddModuleDialog's own useForm for why.
    resolver: zodResolver(updatePackageSchema),
    defaultValues: { id: moduleId, updatedAt: "" },
  });

  // Populate the form once the real row loads — react-hook-form's own
  // defaultValues are fixed at mount, before the fetch resolves.
  useEffect(() => {
    if (!current) return;
    reset({
      id: current.id,
      name: current.name,
      allocatedAmount: current.allocatedAmount,
      internalAmount: current.internalAmount,
      leadProfileId: current.leadProfileId ?? "",
      status: current.status,
      updatedAt: current.updatedAt,
    });
  }, [current, reset]);

  const update = useAction(updatePackage, {
    onSuccess: () => {
      closeDialog();
      toast("Saved");
      router.refresh();
    },
    onError: ({ error }) => {
      // The stale-write conflict (architecture.md §8.3) surfaces through the
      // same serverError channel every other domain error uses.
      if (error.serverError) toast(error.serverError);
    },
  });

  const onSubmit = handleSubmit((values) => update.execute(values));

  if (current === undefined) {
    return (
      <DialogShell title="Edit Package" okLabel="Save" okDisabled onClose={closeDialog} onOk={() => {}}>
        <p className="text-[13.5px] text-muted-foreground">Loading…</p>
      </DialogShell>
    );
  }
  if (current === null) return null;

  return (
    <DialogShell
      title="Edit Package"
      okLabel={update.isPending ? "Saving…" : "Save"}
      okDisabled={update.isPending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3.5">
        <input type="hidden" {...register("updatedAt")} />
        <div className="col-span-2">
          <Field label="Package Name" htmlFor="em-name">
            <input id="em-name" className={inputClass} {...register("name")} />
          </Field>
          {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <Field label="Allocated Budget" htmlFor="em-alloc">
            <input id="em-alloc" className={inputClass} {...register("allocatedAmount")} />
          </Field>
          {errors.allocatedAmount && (
            <p className="text-xs text-destructive mt-1">{errors.allocatedAmount.message}</p>
          )}
        </div>
        <div>
          <Field label="Internal Budget" htmlFor="em-internal">
            <input id="em-internal" className={inputClass} {...register("internalAmount")} />
          </Field>
          {errors.internalAmount && (
            <p className="text-xs text-destructive mt-1">{errors.internalAmount.message}</p>
          )}
        </div>
        <div>
          <Field label="Lead" htmlFor="em-lead">
            <select id="em-lead" className={inputClass} disabled={!staff} {...register("leadProfileId")}>
              <option value="">To assign</option>
              {staff?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div>
          <Field label="Status" htmlFor="em-status">
            <select id="em-status" className={inputClass} {...register("status")}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {update.result.serverError && (
          <p className="col-span-2 text-[12.5px] text-destructive">{update.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
