"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";

export function AddTaskDialog({ projectId, moduleId }: { projectId: string; moduleId: string }) {
  const { data, closeDialog, addTask, toast } = useApp();
  const m = data.projects.find((p) => p.id === projectId)?.modules.find((x) => x.id === moduleId);

  const [task, setTask] = useState("");
  const [pkg, setPkg] = useState(m?.packages[0]?.id ?? "");
  const [owner, setOwner] = useState("");
  const [w, setW] = useState("6");
  const [d, setD] = useState("2");

  if (!m) return null;

  return (
    <DialogShell
      title="Add Task"
      description={m.name}
      okLabel="Add"
      onClose={closeDialog}
      onOk={() => {
        addTask(projectId, moduleId, { t: task, pkg, owner, w: +w || 1, d: +d || 1 });
        closeDialog();
        toast("Task added");
      }}
    >
      <div className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Task">
            <input className={inputClass} placeholder="Coping stone fixing" value={task} onChange={(e) => setTask(e.target.value)} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Phase">
            <select className={inputClass} value={pkg} onChange={(e) => setPkg(e.target.value)}>
              {m.packages.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
              <option value="">None</option>
            </select>
          </Field>
        </div>
        <Field label="Owner">
          <input className={inputClass} placeholder="Gang, vendor or client" value={owner} onChange={(e) => setOwner(e.target.value)} />
        </Field>
        <Field label="Start Week">
          <input type="number" min={1} max={14} className={inputClass} value={w} onChange={(e) => setW(e.target.value)} />
        </Field>
        <Field label="Duration (weeks)">
          <input type="number" min={1} className={inputClass} value={d} onChange={(e) => setD(e.target.value)} />
        </Field>
      </div>
    </DialogShell>
  );
}
