"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field, inputClass, textareaClass } from "@/components/ui/DialogShell";

export function PostUpdateDialog({ projectId, moduleId }: { projectId: string; moduleId?: string }) {
  const { data, closeDialog, addUpdate, toast } = useApp();
  const router = useRouter();
  const project = data.projects.find((p) => p.id === projectId);

  const [mod, setMod] = useState(moduleId ?? project?.modules[0]?.id ?? "");
  const [date, setDate] = useState("2026-09-07");
  const [text, setText] = useState("");
  const [photoCount, setPhotoCount] = useState(0);

  // The dialog is always opened from inside a project, so this cannot fire.
  // Stated as a guard rather than a `!` — ../AGENTS.md forbids the assertion.
  if (!project) return null;

  return (
    <DialogShell
      title="Post Daily Update"
      okLabel="Post"
      onClose={closeDialog}
      onOk={() => {
        addUpdate(projectId, { mod, date, text, photos: photoCount });
        closeDialog();
        router.push(`/projects/${projectId}/updates`);
        toast("Update posted");
      }}
    >
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Package">
          <select className={inputClass} value={mod} onChange={(e) => setMod(e.target.value)}>
            {project.modules.map((m, i) => (
              <option key={m.id} value={m.id}>
                {String(i + 1).padStart(2, "0")} {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="Work Done">
            <textarea
              className={textareaClass}
              placeholder="What was completed today, what is planned tomorrow, anything blocking"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Photos">
            <input
              type="file"
              multiple
              className="px-1.5 py-1.5"
              onChange={(e) => setPhotoCount(e.target.files?.length ?? 0)}
            />
          </Field>
        </div>
      </div>
    </DialogShell>
  );
}
