"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { createStockRequestSchema } from "@/features/stock/schema";
import {
  createStockRequest,
  getMaterialSuggestions,
  getPackageOptions,
  getUnitOptions,
} from "@/features/stock/actions";
import { getPhaseOptions } from "@/features/schedule/actions";
import { DialogShell, Field, inputClass, textareaClass } from "@/components/ui/DialogShell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/DatePicker";

const selectTriggerClass = "w-full text-[13.5px] data-[size=default]:h-9";

/**
 * build/07-stock-inventory-notifications.md §2.5 step 4: on the server
 * action now. Material name keeps its suggestion list, sourced from real
 * `inventory_items`. The Rate field renders for admin only (the EFFECTIVE
 * role — impersonation shapes what a preview sees, same as everywhere else)
 * *and* is stripped server-side regardless of what this form sends
 * (features/stock/actions.ts's own comment on why that boundary can't live
 * in the UI alone).
 *
 * The mock dialog's "Package"/"Phase" labels mapped to this app's own
 * `modules`/`packages` naming (Build 04's known prototype-vs-schema mismatch,
 * carried forward from AddTaskDialog) — this one uses the real
 * `packages`/`phases` labels directly, matching every dialog converted since.
 *
 * `moduleId`, when the caller has one (e.g. the "+ Stock Request" button on
 * a package's own detail page), pre-selects that package — restored after
 * review found the prop was accepted but silently dropped, breaking the
 * one caller (`PackageDetailActions.tsx`) that already relies on it.
 */
export function NewRequestDialog({ projectId, moduleId }: { projectId: string; moduleId?: string }) {
  const { role, closeDialog, toast } = useApp();
  // The EFFECTIVE role: impersonation shapes what a preview sees, same as
  // every other read-shaping check in this build (`useApp().role` is
  // exactly that, computed server-side in app/(app)/layout.tsx — restored
  // after review found this used the REAL role instead, contradicting this
  // file's own comment above and the app's own impersonation-preview rule).
  const isAdmin = role === "owner" || role === "admin";
  const router = useRouter();

  const [packages, setPackages] = useState<{ id: string; name: string }[] | null>(null);
  const [phases, setPhases] = useState<{ id: string; name: string }[] | null>(null);
  const [materials, setMaterials] = useState<string[]>([]);
  const [units, setUnits] = useState<{ code: string; label: string }[] | null>(null);

  useEffect(() => {
    getPackageOptions(projectId)
      .then(setPackages)
      .catch(() => toast("Could not load packages."));
    getMaterialSuggestions()
      .then(setMaterials)
      .catch(() => toast("Could not load material suggestions."));
    getUnitOptions()
      .then(setUnits)
      .catch(() => toast("Could not load units."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createStockRequestSchema),
    defaultValues: {
      projectId,
      packageId: moduleId ?? "",
      phaseId: "",
      materialName: "",
      qty: 0,
      unit: "",
      rate: undefined,
      neededBy: "",
      note: "",
    },
  });

  // Plain state, not `watch("packageId")`: react-hook-form's `watch` returns
  // a function the React Compiler cannot safely memoize (confirmed live —
  // it skips memoizing this component and says so), the same class of
  // incompatible-library warning FileUploader's own upload queue hit twice
  // in Build 06. The package Select's `onValueChange` sets this alongside
  // the Controller's own `field.onChange`, so the form value stays in step.
  const [packageId, setPackageId] = useState(moduleId ?? "");
  useEffect(() => {
    // No package selected: nothing to fetch, and nothing to reset here —
    // `visiblePhases` below derives "no package selected yet" from
    // `packageId` directly, rather than this effect calling `setPhases(null)`
    // synchronously (react-hooks/set-state-in-effect: exactly the cascading
    // extra render that rule exists to catch — confirmed live).
    if (!packageId) return;
    getPhaseOptions(packageId)
      .then(setPhases)
      .catch(() => toast("Could not load phases."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);
  const visiblePhases = packageId ? phases : null;

  // Base UI's Select.Value shows the raw value (a uuid) unless the root has
  // `items` to resolve the label from. Form values keep "" for "none" — the
  // schema's own shape — and map to Base UI's null only at the Select.
  const packageItems = packages?.map((p) => ({ value: p.id, label: p.name })) ?? [];
  const phaseItems: { value: string | null; label: string }[] = visiblePhases?.length
    ? [{ value: null, label: "None" }, ...visiblePhases.map((p) => ({ value: p.id, label: p.name }))]
    : [];
  const unitItems = units?.map((u) => ({ value: u.code, label: u.code })) ?? [];

  const create = useAction(createStockRequest, {
    onSuccess: ({ data }) => {
      closeDialog();
      toast(`Request ${data?.refNo ?? ""} submitted`);
      router.push(`/projects/${projectId}/stock`);
      router.refresh();
    },
  });

  const onSubmit = handleSubmit((values) => create.execute(values));

  return (
    <DialogShell
      title="New Stock Request"
      okLabel={create.isPending ? "Submitting…" : "Submit"}
      okPending={create.isPending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Package" htmlFor="nr-package">
            <Controller
              control={control}
              name="packageId"
              render={({ field }) => (
                <Select
                  items={packageItems}
                  disabled={!packages}
                  value={packages ? field.value || null : null}
                  onValueChange={(v) => {
                    field.onChange(v ?? "");
                    setPackageId(v ?? "");
                    setValue("phaseId", "");
                  }}
                >
                  <SelectTrigger
                    id="nr-package"
                    ref={field.ref}
                    onBlur={field.onBlur}
                    className={selectTriggerClass}
                  >
                    <SelectValue placeholder={packages ? "Select a package" : "Loading…"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {packageItems.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          {errors.packageId && <p className="text-xs text-destructive mt-1">{errors.packageId.message}</p>}
        </div>
        <div className="col-span-2">
          <Field label="Phase" htmlFor="nr-phase">
            <Controller
              control={control}
              name="phaseId"
              render={({ field }) => (
                <Select
                  items={phaseItems}
                  disabled={!visiblePhases?.length}
                  value={visiblePhases?.length ? field.value || null : null}
                  onValueChange={(v) => field.onChange(v ?? "")}
                >
                  <SelectTrigger
                    id="nr-phase"
                    ref={field.ref}
                    onBlur={field.onBlur}
                    className={selectTriggerClass}
                  >
                    <SelectValue
                      placeholder={
                        visiblePhases?.length ? "None" : packageId ? "Loading…" : "Select a package first"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {phaseItems.map((p) => (
                        <SelectItem key={p.value ?? "none"} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Material" htmlFor="nr-material">
            <input
              id="nr-material"
              className={inputClass}
              placeholder="Pool-grade vitrified tile 300x300"
              list="materials"
              {...register("materialName")}
            />
            <datalist id="materials">
              {materials.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          {errors.materialName && (
            <p className="text-xs text-destructive mt-1">{errors.materialName.message}</p>
          )}
        </div>
        <Field label="Quantity" htmlFor="nr-qty">
          <div className="flex gap-2">
            <input
              id="nr-qty"
              type="number"
              step="any"
              className={inputClass}
              placeholder="0"
              {...register("qty")}
            />
            <Controller
              control={control}
              name="unit"
              render={({ field }) => (
                <Select
                  items={unitItems}
                  disabled={!units}
                  value={units ? field.value || null : null}
                  onValueChange={(v) => field.onChange(v ?? "")}
                >
                  <SelectTrigger
                    aria-label="Unit"
                    ref={field.ref}
                    onBlur={field.onBlur}
                    className={selectTriggerClass}
                    style={{ flex: "0 0 90px" }}
                  >
                    <SelectValue placeholder={units ? "Unit" : "…"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {unitItems.map((u) => (
                        <SelectItem key={u.value} value={u.value}>
                          {u.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          {(errors.qty || errors.unit) && (
            <p className="text-xs text-destructive mt-1">{errors.qty?.message ?? errors.unit?.message}</p>
          )}
        </Field>
        <Field label="Needed By" htmlFor="nr-needed">
          <Controller
            control={control}
            name="neededBy"
            render={({ field }) => (
              <DatePicker id="nr-needed" value={field.value ?? ""} onChange={field.onChange} />
            )}
          />
        </Field>
        {isAdmin && (
          <Field label="Rate (₹ per unit)" htmlFor="nr-rate">
            <input
              id="nr-rate"
              type="number"
              step="any"
              className={inputClass}
              placeholder="Optional"
              {...register("rate")}
            />
          </Field>
        )}
        <div className="col-span-2">
          <Field label="Note" htmlFor="nr-note">
            <textarea id="nr-note" className={textareaClass} placeholder="Optional" {...register("note")} />
          </Field>
        </div>
        {create.result.serverError && (
          <p className="col-span-2 text-[12.5px] text-destructive">{create.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
