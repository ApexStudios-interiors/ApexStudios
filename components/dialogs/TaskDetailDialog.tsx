"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field, inputClass, textareaClass } from "@/components/ui/DialogShell";

export function TaskDetailDialog({
  projectId,
  moduleId,
  taskIndex,
}: {
  projectId: string;
  moduleId: string;
  taskIndex: number;
}) {
  const { data, closeDialog, updateTask, toast } = useApp();
  const m = data.projects.find((p) => p.id === projectId)?.modules.find((x) => x.id === moduleId);
  const t = m?.tasks[taskIndex];

  const [p, setP] = useState(t?.p ?? 0);
  const [w, setW] = useState(String(t?.w ?? 1));
  const [d, setD] = useState(String(t?.d ?? 1));

  if (!t) return null;

  return (
    <DialogShell
      title={t.t}
      description={t.owner}
      okLabel="Save"
      onClose={closeDialog}
      onOk={() => {
        updateTask(projectId, moduleId, taskIndex, { p, w: +w || t.w, d: +d || t.d });
        closeDialog();
        toast("Saved");
      }}
    >
      <div className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Progress" hint={`${p}%`}>
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={p}
              onChange={(e) => setP(+e.target.value)}
              className="w-full accent-current"
            />
          </Field>
        </div>
        <Field label="Start Week">
          <input type="number" className={inputClass} value={w} onChange={(e) => setW(e.target.value)} />
        </Field>
        <Field label="Duration (weeks)">
          <input type="number" className={inputClass} value={d} onChange={(e) => setD(e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="Note">
            <textarea className={textareaClass} placeholder="Optional" />
          </Field>
        </div>
      </div>
    </DialogShell>
  );
}
