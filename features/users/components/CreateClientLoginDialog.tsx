"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";
import { createClientLogin } from "@/features/users/actions";
import { createClientLoginSchema } from "@/features/users/schema";
import { emailForUsername } from "@/features/users/service";
import { CreatedCredentialsDialog, type CreatedCredentials } from "./CreatedCredentialsDialog";

/**
 * D51: a client login, created from the project it is for. Same username rules,
 * generated password and show-once credentials as Add User; the role is always
 * Client and the account is a member of `projectId` from the moment it exists.
 */
export function CreateClientLoginDialog({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCredentials | null>(null);

  const create = useAction(createClientLogin, {
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.status === "username_taken") {
        setFieldError(`“${data.username}” is already taken.`);
        return;
      }
      setCreated({ username: data.username, email: data.email, password: data.password });
      toast("Client login created");
      router.refresh();
    },
  });

  if (created) {
    return <CreatedCredentialsDialog title="Client login created" created={created} onClose={closeDialog} />;
  }

  const trimmed = username.trim().toLowerCase();
  const submit = () => {
    const parsed = createClientLoginSchema.safeParse({ projectId, username, fullName });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Check the username");
      return;
    }
    setFieldError(null);
    create.execute(parsed.data);
  };

  return (
    <DialogShell
      title="Create client login"
      description={`The new login can see ${projectName}. Give it access to more projects from each project's Client access card.`}
      okLabel={create.isPending ? "Creating…" : "Create login"}
      okDisabled={create.isPending}
      onClose={closeDialog}
      onOk={submit}
    >
      <form
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <Field
            label="Username"
            hint={trimmed ? `Signs in as ${emailForUsername(trimmed)}` : undefined}
            htmlFor="ccl-username"
          >
            <input
              id="ccl-username"
              className={inputClass}
              placeholder="tvrao"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={fieldError ? true : undefined}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setFieldError(null);
              }}
            />
          </Field>
          {fieldError && <p className="text-xs text-destructive mt-1">{fieldError}</p>}
        </div>
        <Field label="Name" hint="Optional — defaults to the username" htmlFor="ccl-name">
          <input
            id="ccl-name"
            className={inputClass}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </Field>
        {create.result.serverError && (
          <p className="text-[12.5px] text-destructive">{create.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
