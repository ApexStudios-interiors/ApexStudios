"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { createProjectSchema } from "@/features/projects/schema";
import { createProject, getClientOptions, previewProjectCode } from "@/features/projects/actions";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";
import { ClientCombobox, type ClientOption } from "./ClientCombobox";

/**
 * build/04-projects-packages-phases.md §4.5: react-hook-form + the same zod
 * schema the action parses, submitting to the Server Action.
 *
 * Client is a combobox over the org's clients (`clients` is admin-only on
 * select — getClientOptions is the guarded read) that can create a missing
 * client inline. Project Code is no longer typed: it is generated server-side
 * from the name (D17's BHEL-NCH convention) and shown here read-only, from a
 * debounced preview of what rpc_create_project would pick.
 */
export function AddProjectDialog() {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [clients, setClients] = useState<ClientOption[] | null>(null);

  useEffect(() => {
    getClientOptions()
      .then(setClients)
      .catch(() => toast("Could not load clients."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    // No explicit generic — `packages`' `.default([])` gives the schema's
    // input and output types different optionality for that field, which a
    // hand-specified generic can't reconcile with zodResolver's own; letting
    // it infer from the resolver is the pattern @hookform/resolvers documents
    // for a schema with any `.default()`.
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: "", clientId: "", location: "", startDate: "", packages: [] },
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

  // Debounced so typing a name issues one round trip, not one per keystroke.
  // `executeAsync` results are matched against the name they were asked for,
  // so a slow earlier response can never overwrite a newer one.
  const name = useWatch({ control, name: "name" });
  const preview = useAction(previewProjectCode);
  const [code, setCode] = useState<{ for: string; value: string } | null>(null);
  const trimmedName = name.trim();
  useEffect(() => {
    if (!trimmedName) return;
    const timer = setTimeout(() => {
      preview.executeAsync({ name: trimmedName }).then((res) => {
        if (res?.data) setCode({ for: trimmedName, value: res.data.code });
      });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedName]);
  const codeShown = trimmedName && code?.for === trimmedName ? code.value : "";

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
            <input
              id="ap-name"
              className={inputClass}
              placeholder="Model Villas Interiors"
              {...register("name")}
            />
          </Field>
          {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <Field label="Client" htmlFor="ap-client">
            <Controller
              control={control}
              name="clientId"
              render={({ field }) => (
                <ClientCombobox
                  id="ap-client"
                  clients={clients}
                  value={field.value}
                  onChange={field.onChange}
                  onCreated={(c) => setClients((prev) => [...(prev ?? []), c])}
                  invalid={!!errors.clientId}
                />
              )}
            />
          </Field>
          {errors.clientId && <p className="text-xs text-destructive mt-1">{errors.clientId.message}</p>}
        </div>
        <div>
          <Field label="Project Code" hint="Generated from the project name" htmlFor="ap-code">
            <input
              id="ap-code"
              className={`${inputClass} bg-muted font-mono tracking-wide`}
              readOnly
              tabIndex={-1}
              placeholder={trimmedName ? "Generating…" : "—"}
              value={codeShown}
            />
          </Field>
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
