"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { createPackageSchema } from "@/features/packages/schema";
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
      .catch(() => toast("Could not load staff."));
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
    formState: { errors },
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

  return (
    <DialogShell
      title="Add Package"
      okLabel={create.isPending ? "Adding…" : "Add"}
      okDisabled={create.isPending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Package Name" htmlFor="am-name">
            <input id="am-name" className={inputClass} placeholder="Landscape" {...register("name")} />
          </Field>
          {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <Field label="Allocated Budget" htmlFor="am-alloc">
            <input id="am-alloc" className={inputClass} placeholder="₹" {...register("allocatedAmount")} />
          </Field>
          {errors.allocatedAmount && (
            <p className="text-xs text-destructive mt-1">{errors.allocatedAmount.message}</p>
          )}
        </div>
        <div>
          <Field label="Internal Budget" htmlFor="am-internal">
            <input id="am-internal" className={inputClass} placeholder="₹" {...register("internalAmount")} />
          </Field>
          {errors.internalAmount && (
            <p className="text-xs text-destructive mt-1">{errors.internalAmount.message}</p>
          )}
        </div>
        <div className="col-span-2">
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
          <p className="col-span-2 text-[12.5px] text-destructive">{create.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
