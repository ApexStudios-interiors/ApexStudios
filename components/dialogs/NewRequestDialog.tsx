"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field, inputClass, textareaClass } from "@/components/ui/DialogShell";
import { isMoney } from "@/lib/logic";

const MATERIALS = [
  "Pool-grade vitrified tile 300x300, anti-skid",
  "Dr. Fixit Pidifin 2K, 20 kg kit",
  "Ultratech 53 grade cement, 50 kg",
  "uPVC pipe 63 mm SCH 80, 3 m",
  "Tile adhesive, pool grade, 20 kg",
  "Epoxy grout, 5 kg",
];
const UNITS = ["sft", "nos", "bag", "kit", "len", "kg", "rft"] as const;

export function NewRequestDialog({ projectId, moduleId }: { projectId: string; moduleId?: string }) {
  const { data, role, closeDialog, addRequest, toast } = useApp();
  const router = useRouter();
  const project = data.projects.find((p) => p.id === projectId);

  const [mod, setMod] = useState(moduleId ?? project?.modules[0]?.id ?? "");
  const modObj = useMemo(() => project?.modules.find((m) => m.id === mod), [project, mod]);
  const [pkg, setPkg] = useState(modObj?.packages[0]?.id ?? "");
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<string>(UNITS[0]);
  const [need, setNeed] = useState("2026-09-15");
  const [rate, setRate] = useState("");

  // The dialog is always opened from inside a project, so this cannot fire.
  // Stated as a guard rather than a `!` — ../AGENTS.md forbids the assertion.
  if (!project) return null;

  const onModChange = (id: string) => {
    setMod(id);
    const nm = project.modules.find((m) => m.id === id);
    setPkg(nm?.packages[0]?.id ?? "");
  };

  return (
    <DialogShell
      title="New Stock Request"
      okLabel="Submit"
      onClose={closeDialog}
      onOk={() => {
        addRequest(projectId, {
          mod,
          pkg: pkg || undefined,
          item,
          qty: +qty || 0,
          unit,
          rate: +rate || 0,
          need,
        });
        closeDialog();
        router.push(`/projects/${projectId}/stock`);
        toast("Request submitted");
      }}
    >
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Package">
          <select className={inputClass} value={mod} onChange={(e) => onModChange(e.target.value)}>
            {project.modules.map((m, i) => (
              <option key={m.id} value={m.id}>
                {String(i + 1).padStart(2, "0")} {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Phase">
          <select className={inputClass} value={pkg} onChange={(e) => setPkg(e.target.value)}>
            {modObj && modObj.packages.length ? (
              modObj.packages.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))
            ) : (
              <option value="">None</option>
            )}
          </select>
        </Field>
        <div className="col-span-2">
          <Field label="Material">
            <input
              className={inputClass}
              placeholder="Pool-grade vitrified tile 300x300"
              list="materials"
              value={item}
              onChange={(e) => setItem(e.target.value)}
            />
            <datalist id="materials">
              {MATERIALS.map((mm) => (
                <option key={mm} value={mm} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label="Quantity">
          <div className="flex gap-2">
            <input
              type="number"
              className={inputClass}
              placeholder="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <select
              className={inputClass}
              style={{ flex: "0 0 90px" }}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
        </Field>
        <Field label="Needed By">
          <input type="date" className={inputClass} value={need} onChange={(e) => setNeed(e.target.value)} />
        </Field>
        {isMoney(role) && (
          <Field label="Rate (₹ per unit)">
            <input
              type="number"
              className={inputClass}
              placeholder="Optional"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
        )}
        <div className="col-span-2">
          <Field label="Note">
            <textarea className={textareaClass} placeholder="Optional" />
          </Field>
        </div>
      </div>
    </DialogShell>
  );
}
