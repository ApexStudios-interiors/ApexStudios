"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addUser } from "@/features/users/actions";
import { addUserSchema, type AddUserInput } from "@/features/users/schema";
import { emailForUsername } from "@/features/users/service";
import {
  CreatedCredentialsDialog,
  type CreatedCredentials,
} from "@/features/users/components/CreatedCredentialsDialog";
import { ROLE_LABEL } from "@/lib/rbac/roles";

type AssignableRole = AddUserInput["role"];

const ROLE_ITEMS: { value: AssignableRole; label: string }[] = [
  { value: "site", label: ROLE_LABEL.site },
  { value: "admin", label: ROLE_LABEL.admin },
];

/**
 * Add User (formerly Invite User — the file and the `inviteUser` dialog kind
 * keep their names so DialogHost and AppContext are untouched).
 *
 * Staff only: Admin or Site Supervisor. A client login is created from its
 * project's dashboard instead (D51, CreateClientLoginDialog), and the schema
 * refuses `client` here too.
 *
 * Two states in one dialog: the form, then — once, after creation — the
 * username and generated password, each with a Copy button
 * (CreatedCredentialsDialog).
 */
export function InviteUserDialog() {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<AssignableRole>("site");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCredentials | null>(null);

  const add = useAction(addUser, {
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.status === "username_taken") {
        setFieldError(`“${data.username}” is already taken.`);
        return;
      }
      setCreated({ username: data.username, email: data.email, password: data.password });
      toast("User added");
      router.refresh();
    },
  });

  if (created) {
    return <CreatedCredentialsDialog title="User added" created={created} onClose={closeDialog} />;
  }

  const trimmed = username.trim().toLowerCase();
  const submit = () => {
    const parsed = addUserSchema.safeParse({ username, fullName, role });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Check the username");
      return;
    }
    setFieldError(null);
    add.execute(parsed.data);
  };

  return (
    <DialogShell
      title="Add User"
      okLabel={add.isPending ? "Adding…" : "Add User"}
      okPending={add.isPending}
      onClose={closeDialog}
      onOk={submit}
    >
      <form
        className="grid grid-cols-2 gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="col-span-2">
          <Field
            label="Username"
            hint={trimmed ? `Signs in as ${emailForUsername(trimmed)}` : undefined}
            htmlFor="au-username"
          >
            <input
              id="au-username"
              className={inputClass}
              placeholder="suresh"
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
        <div className="col-span-2">
          <Field label="Name" hint="Optional — defaults to the username" htmlFor="au-name">
            <input
              id="au-name"
              className={inputClass}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Role" htmlFor="au-role">
            <Select
              items={ROLE_ITEMS}
              value={role}
              onValueChange={(v) => {
                if (v) setRole(v);
              }}
            >
              <SelectTrigger id="au-role" className={`${inputClass} w-full`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {ROLE_ITEMS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>
        {add.result.serverError && (
          <p className="col-span-2 text-[12.5px] text-destructive">{add.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
