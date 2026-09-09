"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field, inputClass, textareaClass } from "@/components/ui/DialogShell";

const TYPES = ["Material sample", "Material", "Drawing", "Design", "Variation"] as const;

export function NewApprovalDialog({ projectId, moduleId }: { projectId: string; moduleId?: string }) {
  const { data, closeDialog, addApproval, toast } = useApp();
  const router = useRouter();
  const project = data.projects.find((p) => p.id === projectId);

  const [mod, setMod] = useState(moduleId ?? project?.modules[0]?.id ?? "");
  const modObj = useMemo(() => project?.modules.find((m) => m.id === mod), [project, mod]);
  const [pkg, setPkg] = useState(modObj?.packages[0]?.id ?? "");
  const [type, setType] = useState<string>(TYPES[0]);
  const [need, setNeed] = useState("2026-09-14");
  const [item, setItem] = useState("");
  const [note, setNote] = useState("");
  const [photoCount, setPhotoCount] = useState(0);

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
      title="Request Approval"
      description="Sent to the client for sign-off."
      okLabel="Send"
      onClose={closeDialog}
      onOk={() => {
        addApproval(projectId, { mod, pkg: pkg || undefined, type, item, need, note, photos: photoCount });
        closeDialog();
        router.push(`/projects/${projectId}/approvals`);
        toast("Approval request sent");
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
        <Field label="Type">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Needed By">
          <input type="date" className={inputClass} value={need} onChange={(e) => setNeed(e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="Item">
            <input
              className={inputClass}
              placeholder="Pool tile, ivory 300x300 anti-skid (Kajaria)"
              value={item}
              onChange={(e) => setItem(e.target.value)}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Note">
            <textarea
              className={textareaClass}
              placeholder="Optional"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Sample Photos">
            <input
              type="file"
              accept="image/*"
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
