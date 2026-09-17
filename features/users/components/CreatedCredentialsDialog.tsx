"use client";

import { DialogShell, Field } from "@/components/ui/DialogShell";
import { CopyField } from "./CopyField";

export type CreatedCredentials = { username: string; email: string; password: string };

/**
 * The second state of Add User and Create client login: the username and the
 * generated password, each with a Copy button, shown once. The password lives
 * only in the calling dialog's state; closing discards it and nothing can show
 * it again.
 */
export function CreatedCredentialsDialog({
  title,
  created,
  onClose,
}: {
  title: string;
  created: CreatedCredentials;
  onClose: () => void;
}) {
  return (
    <DialogShell
      title={title}
      description="Share these with the user now. The password is shown only once — it cannot be viewed again after you close this dialog."
      okLabel="Done"
      onClose={onClose}
      onOk={onClose}
    >
      <div className="grid gap-3.5">
        <Field label="Username" hint={`Signs in as ${created.email}`} htmlFor="au-created-username">
          <CopyField id="au-created-username" label="username" value={created.username} />
        </Field>
        <Field label="Password" htmlFor="au-created-password">
          <CopyField id="au-created-password" label="password" value={created.password} />
        </Field>
      </div>
    </DialogShell>
  );
}
