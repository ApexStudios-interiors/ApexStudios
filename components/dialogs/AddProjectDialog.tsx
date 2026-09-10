"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { createProjectSchema } from "@/features/projects/schema";
import { createProject, getClientOptions } from "@/features/projects/actions";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";

/**
 * build/04-projects-packages-phases.md §4.5: react-hook-form + the same zod
 * schema the action parses, submitting to the Server Action. The prototype
 * had a free-text Client field with one hard-coded name; `clientId` is a real
 * foreign key now, so this gained a dropdown fetched from the database
 * (`clients` is admin-only on select — getClientOptions is the guarded read)
 * and a Project Code field the mock system never needed (D17's BHEL-NCH
 * convention).
 */
export function AddProjectDialog() {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [clients, setClients] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    getClientOptions()
      .then(setClients)
      .catch(() => toast("Could not load clients."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    // No explicit generic — `packages`' `.default([])` gives the schema's
    // input and output types different optionality for that field, which a
    // hand-specified generic can't reconcile with zodResolver's own; letting
    // it infer from the resolver is the pattern @hookform/resolvers documents
    // for a schema with any `.default()`.
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: "", clientId: "", code: "", location: "", startDate: "", packages: [] },
  });

  const create = useAction(createProject, {
    onSuccess: ({ data }) => {
      closeDialog();
      if (data) router.push(`/projects/${data.id}`);
      toast("Project created");
      // Also revalidates "/"'s own cache for when the user navigates back to it.
      router.refresh();
    },
  });

  // The prototype's "comma separated" packages field is a single text input,
  // not an array field react-hook-form registers directly — kept as its own
  // bit of local state and split at submit time, same as the prototype did.
  const [packagesText, setPackagesText] = useState("");

  const onSubmit = handleSubmit((values) => {
    create.execute({
      ...values,
      packages: packagesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  });

  return (
    <DialogShell
      title="New Project"
      okLabel={create.isPending ? "Creating…" : "Create"}
      okDisabled={create.isPending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Project Name" htmlFor="ap-name">
            <input id="ap-name" className={inputClass} placeholder="Model Villas Interiors" {...register("name")} />
          </Field>
          {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <Field label="Client" htmlFor="ap-client">
            <select id="ap-client" className={inputClass} disabled={!clients} {...register("clientId")}>
              <option value="">{clients ? "Select a client" : "Loading…"}</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {errors.clientId && <p className="text-xs text-destructive mt-1">{errors.clientId.message}</p>}
        </div>
        <div>
          <Field label="Project Code" hint="e.g. BHEL-NCH" htmlFor="ap-code">
            <input id="ap-code" className={inputClass} placeholder="BHEL-NCH" {...register("code")} />
          </Field>
          {errors.code && <p className="text-xs text-destructive mt-1">{errors.code.message}</p>}
        </div>
        <Field label="Location" htmlFor="ap-location">
          <input id="ap-location" className={inputClass} {...register("location")} />
        </Field>
        <Field label="Start Date" htmlFor="ap-start">
          <input id="ap-start" type="date" className={inputClass} {...register("startDate")} />
        </Field>
        <div className="col-span-2">
          <Field label="Packages" hint="Comma separated" htmlFor="ap-packages">
            <input
              id="ap-packages"
              className={inputClass}
              placeholder="Interiors, MEP, Facade"
              value={packagesText}
              onChange={(e) => setPackagesText(e.target.value)}
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
