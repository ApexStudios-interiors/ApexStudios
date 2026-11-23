"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { PACKAGE_FIELD_NAME_MAX, createPackageSchema } from "@/features/packages/schema";
import { MoneyEcho } from "@/components/shared/MoneyEcho";
import { InternalOverAllocatedNote } from "./InternalOverAllocatedNote";
import { createPackage, getStaffOptions } from "@/features/packages/actions";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** build/04-projects-packages-phases.md §4.5: react-hook-form + the same zod
 *  schema `createPackage` parses. `leadProfileId` is a real profile UUID —
 *  the prototype's fixed name list is now a dropdown fetched from the
 *  database. */
export function AddModuleDialog({ projectId }: { projectId: string }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [staff, setStaff] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    getStaffOptions()
      .then(setStaff)
      .catch(() => toast("Could not load staff.", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "To assign" is Base UI's `null` item (its "no selection"); the form still
  // holds `""` for it, which createPackageSchema turns into `undefined`.
  // `items` lets the closed trigger show the lead's name, not their UUID.
  const leadItems = useMemo(
    () => [
      { value: null, label: staff ? "To assign" : "Loading…" },
      ...(staff ?? []).map((s) => ({ value: s.id, label: s.name })),
    ],
    [staff]
  );

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm({
    // No explicit generic — leadProfileId's "" -> undefined transform gives
    // the schema's input and output types different shapes for that field,
    // same reason AddProjectDialog's own useForm skips one.
    resolver: zodResolver(createPackageSchema),
    defaultValues: { projectId, name: "", allocatedAmount: "", internalAmount: "", leadProfileId: "" },
  });

  const create = useAction(createPackage, {
    onSuccess: () => {
      closeDialog();
      toast("Package added");
      // revalidatePath marks the server cache stale; the currently-mounted
      // page still needs telling to actually re-render with it (the same
      // pattern app/(auth)/login/page.tsx uses after signInWithPassword).
      router.refresh();
    },
  });

  const onSubmit = handleSubmit((values) => create.execute(values));
  const [allocated, internal] = useWatch({ control, name: ["allocatedAmount", "internalAmount"] });

  return (
    <DialogShell
      title="Add Package"
      okLabel={create.isPending ? "Adding…" : "Add"}
      okPending={create.isPending}
      dirty={isDirty}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div className="sm:col-span-2">
          <Field label="Package Name" htmlFor="am-name">
            <input
              id="am-name"
              className={inputClass}
              placeholder="Landscape"
              maxLength={PACKAGE_FIELD_NAME_MAX}
              {...register("name")}
            />
          </Field>
          {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <Field label="Allocated Budget" htmlFor="am-alloc" error={errors.allocatedAmount?.message}>
            <input
              id="am-alloc"
              className={inputClass}
              placeholder="₹ e.g. 45,00,000"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={!!errors.allocatedAmount}
              aria-describedby="am-alloc-echo"
              {...register("allocatedAmount")}
            />
          </Field>
          <MoneyEcho id="am-alloc-echo" value={allocated} />
        </div>
        <div>
          <Field label="Internal Budget" htmlFor="am-internal" error={errors.internalAmount?.message}>
            <input
              id="am-internal"
              className={inputClass}
              placeholder="₹ e.g. 25,00,000"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={!!errors.internalAmount}
              aria-describedby="am-internal-echo"
              {...register("internalAmount")}
            />
          </Field>
          <MoneyEcho id="am-internal-echo" value={internal} />
        </div>
        <InternalOverAllocatedNote allocated={allocated} internal={internal} className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <Field label="Lead" htmlFor="am-lead">
            <Controller
              control={control}
              name="leadProfileId"
              render={({ field }) => (
                <Select
                  items={leadItems}
                  disabled={!staff}
                  // null until staff loads: no items means no label to show.
                  value={staff ? field.value || null : null}
                  onValueChange={(value: string | null) => field.onChange(value ?? "")}
                  onOpenChange={(open) => {
                    if (!open) field.onBlur();
                  }}
                >
                  <SelectTrigger id="am-lead" ref={field.ref} className="h-9 w-full text-[13.5px]">
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
        {create.result.serverError && (
          <p className="sm:col-span-2 text-[12.5px] text-destructive">{create.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
