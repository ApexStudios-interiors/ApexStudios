"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { createProjectSchema, packageNameMessage } from "@/features/projects/schema";
import { isValidPackageName, normalisePackageNames } from "@/features/projects/service";
import {
  createProject,
  findProjectWithName,
  getClientOptions,
  previewProjectCode,
} from "@/features/projects/actions";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/shared/DatePicker";
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
  // Because it is not registered, its zod issues never reach `errors`, so the
  // same pure rule is applied here explicitly. createProjectSchema decides
  // again on the server, which is the boundary: a crafted request cannot get
  // past it.
  const [packagesText, setPackagesText] = useState("");
  const [packagesError, setPackagesError] = useState<string | null>(null);

  // A project with the same name is allowed (a second phase for the same
  // client is a real thing, and the project code is auto-uniqued), so this is
  // a warning that asks for one more deliberate click — never a rejection.
  // `for` is the name the warning is about, so editing the name away from it
  // retires the warning without an effect that resets state.
  const [duplicate, setDuplicate] = useState<{ for: string; id: string; name: string } | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const duplicateShown = duplicate?.for === trimmedName.toLowerCase() ? duplicate : null;

  /** `confirmed` is the second, deliberate action: "Create anyway" submits the
   *  same form with the duplicate check skipped. Passed as an argument rather
   *  than held in state, so the confirming click cannot read a stale value. */
  const submitWith = (confirmed: boolean) =>
    handleSubmit(async (values) => {
      const entries = packagesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const offender = entries.find((name) => !isValidPackageName(name));
      if (offender) {
        setPackagesError(packageNameMessage(offender));
        return;
      }
      setPackagesError(null);

      if (!confirmed) {
        setCheckingDuplicate(true);
        try {
          const existing = await findProjectWithName(values.name);
          if (existing) {
            setDuplicate({ ...existing, for: values.name.toLowerCase() });
            return;
          }
        } catch {
          toast("Could not check for an existing project with this name.");
        } finally {
          setCheckingDuplicate(false);
        }
      }
      setDuplicate(null);

      create.execute({ ...values, packages: normalisePackageNames(entries) });
    });

  const onSubmit = (e?: React.BaseSyntheticEvent) => {
    void submitWith(false)(e);
  };
  const createAnyway = () => {
    void submitWith(true)();
  };

  return (
    <DialogShell
      title="New Project"
      okLabel={create.isPending ? "Creating…" : "Create"}
      okPending={create.isPending || checkingDuplicate}
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
        <div>
          <Field label="Location" htmlFor="ap-location">
            <input
              id="ap-location"
              className={inputClass}
              placeholder="Ghanpur, Hyderabad"
              {...register("location")}
            />
          </Field>
          {errors.location && <p className="text-xs text-destructive mt-1">{errors.location.message}</p>}
        </div>
        <Field label="Start Date" htmlFor="ap-start">
          <Controller
            control={control}
            name="startDate"
            render={({ field }) => (
              <DatePicker
                id="ap-start"
                ref={field.ref}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                required
              />
            )}
          />
        </Field>
        <div className="col-span-2">
          <Field
            label="Packages"
            hint="Comma separated. Letters, numbers, spaces and & - . / only, up to 60 characters each."
            htmlFor="ap-packages"
          >
            <input
              id="ap-packages"
              className={inputClass}
              placeholder="Interiors, MEP, Facade"
              value={packagesText}
              onChange={(e) => {
                setPackagesText(e.target.value);
                setPackagesError(null);
              }}
              aria-invalid={!!packagesError}
            />
          </Field>
          {packagesError && <p className="text-xs text-destructive mt-1">{packagesError}</p>}
        </div>
        {duplicateShown && (
          <div className="col-span-2 rounded-lg bg-status-warning-bg px-3 py-2.5">
            <p className="text-[12.5px] text-status-warning">
              A project called “{duplicateShown.name}” already exists. You can still create this one — its
              project code will be different — but check it is not a duplicate first.
            </p>
            <Button type="button" className="mt-2" onClick={createAnyway} disabled={create.isPending}>
              Create anyway
            </Button>
          </div>
        )}
        {create.result.serverError && (
          <p className="col-span-2 text-[12.5px] text-destructive">{create.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
