"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { useSession } from "@/components/auth/SessionProvider";
import { createStockRequestSchema } from "@/features/stock/schema";
import {
  createStockRequest,
  getMaterialSuggestions,
  getPackageOptions,
  getUnitOptions,
} from "@/features/stock/actions";
import { getPhaseOptions } from "@/features/schedule/actions";
import { DialogShell, Field, inputClass, textareaClass } from "@/components/ui/DialogShell";

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
 */
export function NewRequestDialog({ projectId }: { projectId: string; moduleId?: string }) {
  const { closeDialog, toast } = useApp();
  const session = useSession();
  const isAdmin = session.role === "owner" || session.role === "admin";
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
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createStockRequestSchema),
    defaultValues: {
      projectId,
      packageId: "",
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
  // in Build 06. `register`'s own `onChange` option fires alongside its
  // internal handling, so the field is still form-registered either way.
  const [packageId, setPackageId] = useState("");
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
      okDisabled={create.isPending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Package" htmlFor="nr-package">
            <select
              id="nr-package"
              className={inputClass}
              disabled={!packages}
              {...register("packageId", {
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                  setPackageId(e.target.value);
                  setValue("phaseId", "");
                },
              })}
            >
              <option value="">{packages ? "Select a package" : "Loading…"}</option>
              {packages?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          {errors.packageId && <p className="text-xs text-destructive mt-1">{errors.packageId.message}</p>}
        </div>
        <div className="col-span-2">
          <Field label="Phase" htmlFor="nr-phase">
            <select
              id="nr-phase"
              className={inputClass}
              disabled={!visiblePhases?.length}
              {...register("phaseId")}
            >
              <option value="">
                {visiblePhases?.length ? "None" : packageId ? "Loading…" : "Select a package first"}
              </option>
              {visiblePhases?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
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
            <select
              aria-label="Unit"
              className={inputClass}
              style={{ flex: "0 0 90px" }}
              disabled={!units}
              {...register("unit")}
            >
              <option value="">{units ? "Unit" : "…"}</option>
              {units?.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code}
                </option>
              ))}
            </select>
          </div>
          {(errors.qty || errors.unit) && (
            <p className="text-xs text-destructive mt-1">{errors.qty?.message ?? errors.unit?.message}</p>
          )}
        </Field>
        <Field label="Needed By" htmlFor="nr-needed">
          <input id="nr-needed" type="date" className={inputClass} {...register("neededBy")} />
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
