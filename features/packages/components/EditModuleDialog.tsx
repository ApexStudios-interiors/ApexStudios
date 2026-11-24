"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { PACKAGE_FIELD_NAME_MAX, updatePackageSchema } from "@/features/packages/schema";
import { MoneyEcho } from "@/components/shared/MoneyEcho";
import { InternalOverAllocatedNote } from "./InternalOverAllocatedNote";
import {
  updatePackage,
  getPackageForEdit,
  getStaffOptions,
  type PackageForEdit,
} from "@/features/packages/actions";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
        toast("Could not load this package.", "error");
        setCurrent(null);
      });
    getStaffOptions()
      .then(setStaff)
      .catch(() => toast("Could not load staff.", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  // "To assign" is Base UI's `null` item; the form still holds `""` for it,
  // which updatePackageSchema turns into `undefined`. `items` lets the closed
  // trigger show the lead's name rather than their UUID.
  const leadItems = useMemo(
    () => [
      { value: null, label: "To assign" },
      ...(staff ?? []).map((s) => ({ value: s.id, label: s.name })),
    ],
    [staff]
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
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
      if (error.serverError) toast(error.serverError, "error");
    },
  });

  const onSubmit = handleSubmit((values) => update.execute(values));
  const [allocated, internal] = useWatch({ control, name: ["allocatedAmount", "internalAmount"] });

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
      okPending={update.isPending}
      dirty={isDirty}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <input type="hidden" {...register("updatedAt")} />
        <div className="sm:col-span-2">
          <Field label="Package Name" htmlFor="em-name">
            <input
              id="em-name"
              className={inputClass}
              maxLength={PACKAGE_FIELD_NAME_MAX}
              {...register("name")}
            />
          </Field>
          {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <Field label="Allocated Budget" htmlFor="em-alloc" error={errors.allocatedAmount?.message}>
            <input
              id="em-alloc"
              className={inputClass}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={!!errors.allocatedAmount}
              aria-describedby="em-alloc-echo"
              {...register("allocatedAmount")}
            />
          </Field>
          <MoneyEcho id="em-alloc-echo" value={allocated} />
        </div>
        <div>
          <Field label="Internal Budget" htmlFor="em-internal" error={errors.internalAmount?.message}>
            <input
              id="em-internal"
              className={inputClass}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={!!errors.internalAmount}
              aria-describedby="em-internal-echo"
              {...register("internalAmount")}
            />
          </Field>
          <MoneyEcho id="em-internal-echo" value={internal} />
        </div>
        <InternalOverAllocatedNote allocated={allocated} internal={internal} className="sm:col-span-2" />
        <div>
          <Field label="Lead" htmlFor="em-lead">
            <Controller
              control={control}
              name="leadProfileId"
              render={({ field }) => (
                <Select
                  items={leadItems}
                  disabled={!staff}
                  // Until staff loads there is no label to resolve a saved
                  // lead's UUID against, so the (disabled) trigger shows
                  // "To assign", as the native select did — the form value
                  // itself is left alone.
                  value={staff ? field.value || null : null}
                  onValueChange={(value: string | null) => field.onChange(value ?? "")}
                  onOpenChange={(open) => {
                    if (!open) field.onBlur();
                  }}
                >
                  <SelectTrigger id="em-lead" ref={field.ref} className="h-9 w-full text-[13.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {leadItems.map((item) => (
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
        <div>
          <Field label="Status" htmlFor="em-status">
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select
                  items={STATUSES}
                  value={field.value ?? null}
                  onValueChange={(value) => {
                    // No null item, so Base UI never reports a cleared value
                    // here; the guard only narrows the type.
                    if (value) field.onChange(value);
                  }}
                  onOpenChange={(open) => {
                    if (!open) field.onBlur();
                  }}
                >
                  <SelectTrigger id="em-status" ref={field.ref} className="h-9 w-full text-[13.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
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
