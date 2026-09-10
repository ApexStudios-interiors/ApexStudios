"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";

export function AddModuleDialog({ projectId }: { projectId: string }) {
  const { closeDialog, addModule, toast } = useApp();
  const [name, setName] = useState("");
  const [allocated, setAllocated] = useState("");
  const [internal, setInternal] = useState("");
  const [lead, setLead] = useState("Suresh K");

  return (
    <DialogShell
      title="Add Package"
      okLabel="Add"
      onClose={closeDialog}
      onOk={() => {
        addModule(projectId, {
          name,
          allocated: +allocated.replace(/[^\d]/g, "") || 0,
          internal: +internal.replace(/[^\d]/g, "") || 0,
          lead,
        });
        closeDialog();
        toast("Package added");
      }}
    >
      <div className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Package Name">
            <input
              className={inputClass}
              placeholder="Landscape"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Allocated Budget">
          <input
            className={inputClass}
            placeholder="₹"
            value={allocated}
            onChange={(e) => setAllocated(e.target.value)}
          />
        </Field>
        <Field label="Internal Budget">
          <input
            className={inputClass}
            placeholder="₹"
            value={internal}
            onChange={(e) => setInternal(e.target.value)}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Lead">
            <select className={inputClass} value={lead} onChange={(e) => setLead(e.target.value)}>
              <option>Suresh K</option>
              <option>Prakash R</option>
              <option>To assign</option>
            </select>
          </Field>
        </div>
      </div>
    </DialogShell>
  );
}
