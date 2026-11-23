"use client";

import { useMemo, useState } from "react";
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
import { addUser, createClientLogin } from "@/features/users/actions";
import { addUserSchema, createClientLoginSchema, type StaffRole } from "@/features/users/schema";
import { emailForUsername } from "@/features/users/service";
import {
  CreatedCredentialsDialog,
  type CreatedCredentials,
} from "@/features/users/components/CreatedCredentialsDialog";
import { ROLE_LABEL } from "@/lib/rbac/roles";

type DialogRole = StaffRole | "client";

const ROLE_ITEMS: { value: DialogRole; label: string }[] = [
  { value: "site", label: ROLE_LABEL.site },
  { value: "admin", label: ROLE_LABEL.admin },
  { value: "client", label: ROLE_LABEL.client },
];

/** The result shape addUser and createClientLogin share. */
type CreateResult =
  | { status: "username_taken"; username: string }
  | { status: "created"; username: string; email: string; password: string };

/**
 * Add User (formerly Invite User — the file and the `inviteUser` dialog kind
 * keep their names so DialogHost and AppContext are untouched).
 *
 * Admin, Site Supervisor or Client (D51 amendment, 2026-11-23). Staff go
 * through `addUser`, whose schema stays staff-only. Client asks for a Project
 * and goes through `createClientLogin` — the same action as the project's
 * Client access card — so a client login still always has at least one
 * project it can see; the rule is enforced there, not here.
 *
 * Two states in one dialog: the form, then — once, after creation — the
 * username and generated password, each with a Copy button
 * (CreatedCredentialsDialog).
 */
export function InviteUserDialog({ projects }: { projects: { id: string; name: string }[] }) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<DialogRole>("site");
  const [projectId, setProjectId] = useState<string | null>(projects[0]?.id ?? null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCredentials | null>(null);

  /** `items` lets the closed trigger show the project NAME, not its UUID. */
  const projectItems = useMemo(() => projects.map((p) => ({ value: p.id, label: p.name })), [projects]);

  const onCreated = (data: CreateResult | undefined, message: string) => {
    if (!data) return;
    if (data.status === "username_taken") {
      setFieldError(`“${data.username}” is already taken.`);
      return;
    }
    setCreated({ username: data.username, email: data.email, password: data.password });
    toast(message);
    router.refresh();
  };

  const add = useAction(addUser, { onSuccess: ({ data }) => onCreated(data, "User added") });
  const createClient = useAction(createClientLogin, {
    onSuccess: ({ data }) => onCreated(data, "Client login created"),
  });

  if (created) {
    return (
      <CreatedCredentialsDialog
        title={role === "client" ? "Client login created" : "User added"}
        created={created}
        onClose={closeDialog}
      />
    );
  }

  const isClient = role === "client";
  const pending = add.isPending || createClient.isPending;
  const serverError = isClient ? createClient.result.serverError : add.result.serverError;
  const trimmed = username.trim().toLowerCase();

  const submit = () => {
    if (isClient) {
      if (!projectId) {
        setProjectError("Choose the project this client can see");
        return;
      }
      const parsed = createClientLoginSchema.safeParse({ projectId, username, fullName });
      if (!parsed.success) {
        setFieldError(parsed.error.issues[0]?.message ?? "Check the username");
        return;
      }
      setFieldError(null);
      createClient.execute(parsed.data);
      return;
    }
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
      description={
        isClient
          ? "The client can see the project you choose. Give access to more projects from each project's Client access card."
          : undefined
      }
      okLabel={pending ? "Adding…" : "Add User"}
      okPending={pending}
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
        {isClient && (
          <div className="col-span-2">
            <Field
              label="Project"
              hint={projects.length === 0 ? "Create a project first — a client needs one to see" : undefined}
              htmlFor="au-project"
            >
              <Select
                items={projectItems}
                value={projectId}
                disabled={projects.length === 0}
                onValueChange={(v) => {
                  setProjectId(v);
                  setProjectError(null);
                }}
              >
                <SelectTrigger
                  id="au-project"
                  className={`${inputClass} w-full`}
                  aria-invalid={projectError ? true : undefined}
                >
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {projectItems.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {projectError && <p className="text-xs text-destructive mt-1">{projectError}</p>}
          </div>
        )}
        {serverError && <p className="col-span-2 text-[12.5px] text-destructive">{serverError}</p>}
      </form>
    </DialogShell>
  );
}
