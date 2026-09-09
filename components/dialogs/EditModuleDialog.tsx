"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";

const STATUSES = ["Not started", "Design", "In progress", "Completed"] as const;

export function EditModuleDialog({ projectId, moduleId }: { projectId: string; moduleId: string }) {
  const { data, closeDialog, editModule, toast } = useApp();
  const project = data.projects.find((p) => p.id === projectId);
  const m = project?.modules.find((x) => x.id === moduleId);

  const [name, setName] = useState(m?.name ?? "");
  const [allocated, setAllocated] = useState(String(m?.allocated ?? ""));
  const [internal, setInternal] = useState(String(m?.internal ?? ""));
  const [lead, setLead] = useState(m?.lead ?? "");
  const [status, setStatus] = useState(m?.status ?? STATUSES[0]);

  if (!m) return null;

  return (
    <DialogShell
      title="Edit Package"
      okLabel="Save"
      onClose={closeDialog}
      onOk={() => {
        editModule(projectId, moduleId, {
          name,
          allocated: +allocated.replace(/[^\d]/g, "") || 0,
          internal: +internal.replace(/[^\d]/g, "") || 0,
          lead,
          status,
        });
        closeDialog();
        toast("Saved");
      }}
    >
      <div className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Package Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Allocated Budget">
          <input className={inputClass} value={allocated} onChange={(e) => setAllocated(e.target.value)} />
        </Field>
        <Field label="Internal Budget">
          <input className={inputClass} value={internal} onChange={(e) => setInternal(e.target.value)} />
        </Field>
        <Field label="Lead">
          <input className={inputClass} value={lead} onChange={(e) => setLead(e.target.value)} />
        </Field>
        <Field label="Status">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
    </DialogShell>
  );
}
