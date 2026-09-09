"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";

export function AddProjectDialog() {
  const { closeDialog, addProject, toast } = useApp();
  const router = useRouter();
  const [name, setName] = useState("");
  const [client, setClient] = useState("T V Rao Housing Pvt Ltd");
  const [location, setLocation] = useState("Ghanpur, Hyderabad");
  const [start, setStart] = useState("");
  const [packages, setPackages] = useState("");

  return (
    <DialogShell
      title="New Project"
      okLabel="Create"
      onClose={closeDialog}
      onOk={() => {
        const id = addProject({
          name,
          client,
          location,
          start: start || null,
          packageNames: packages.split(","),
        });
        closeDialog();
        router.push(`/projects/${id}`);
        toast("Project created");
      }}
    >
      <div className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Project Name">
            <input
              className={inputClass}
              placeholder="Model Villas Interiors"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Client">
          <input className={inputClass} value={client} onChange={(e) => setClient(e.target.value)} />
        </Field>
        <Field label="Location">
          <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label="Start Date">
          <input
            type="date"
            className={inputClass}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Packages" hint="Comma separated">
          <input
            className={inputClass}
            placeholder="Interiors, MEP, Facade"
            value={packages}
            onChange={(e) => setPackages(e.target.value)}
          />
        </Field>
      </div>
    </DialogShell>
  );
}
