"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";
import type { Role } from "@/lib/types";

export function InviteUserDialog() {
  const { closeDialog, inviteUser, toast } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("site");

  return (
    <DialogShell
      title="Invite User"
      okLabel="Send Invite"
      onClose={closeDialog}
      onOk={() => {
        inviteUser({ name, email, role });
        closeDialog();
        toast("Invite sent");
      }}
    >
      <div className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Email or Phone">
            <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Role">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="site">Site Supervisor</option>
              <option value="admin">Admin</option>
              <option value="client">Client</option>
            </select>
          </Field>
        </div>
      </div>
    </DialogShell>
  );
}
