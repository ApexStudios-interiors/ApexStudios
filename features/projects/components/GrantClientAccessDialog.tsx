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
import { addProjectMember } from "@/features/projects/actions";
import type { ClientLoginDTO } from "@/features/projects/queries";
import { MEMBER_GRANT_REFUSAL_COPY, type MemberRole } from "@/features/projects/service";

const COPY: Record<
  MemberRole,
  { title: string; label: string; choose: string; none: string; ok: string; done: string }
> = {
  client: {
    title: "Add existing client",
    label: "Client login",
    choose: "Select a client login",
    none: "No other client logins",
    ok: "Give access",
    done: "Access granted",
  },
  site: {
    title: "Add site supervisor",
    label: "Site Supervisor",
    choose: "Select a site supervisor",
    none: "No other site supervisors",
    ok: "Add to project",
    done: "Added to the site team",
  },
};

/**
 * Give an existing login access to this project: a client login (D51 — one
 * client company often has several projects) or, with `role="site"`, a Site
 * Supervisor (APX-12, the Site team card). A thin form over addProjectMember;
 * the options are the org's logins of that role that are not yet members,
 * read by the page and passed in. `expectedRole` makes the server refuse a
 * profile of the other role.
 */
export function GrantClientAccessDialog({
  projectId,
  projectName,
  clients,
  role = "client",
}: {
  projectId: string;
  projectName: string;
  clients: ClientLoginDTO[];
  role?: MemberRole;
}) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const copy = COPY[role];

  const items = clients.map((c) => ({
    value: c.id,
    label: c.email ? `${c.fullName} (${c.email})` : c.fullName,
  }));

  const grant = useAction(addProjectMember, {
    onSuccess: ({ data }) => {
      if (data?.status === "refused") {
        setRefusal(MEMBER_GRANT_REFUSAL_COPY[data.reason]);
        return;
      }
      toast(data?.status === "already_member" ? "Already has access" : copy.done);
      router.refresh();
      closeDialog();
    },
  });

  const error = refusal ?? grant.result.serverError;

  return (
    <DialogShell
      title={copy.title}
      description={
        role === "site"
          ? `Choose a Site Supervisor who should see ${projectName}. They can then post updates, raise stock requests and update tasks on it.`
          : `Choose a client login that should also see ${projectName}.`
      }
      okLabel={grant.isPending ? "Adding…" : copy.ok}
      okPending={grant.isPending}
      okDisabled={!profileId}
      onClose={closeDialog}
      onOk={() => {
        setRefusal(null);
        if (profileId) grant.execute({ projectId, profileId, expectedRole: role });
      }}
    >
      <div className="grid gap-3.5">
        <Field label={copy.label} htmlFor="gca-client">
          <Select
            items={items}
            value={profileId}
            onValueChange={(v) => setProfileId(v)}
            disabled={items.length === 0}
          >
            <SelectTrigger id="gca-client" className={`${inputClass} w-full`}>
              <SelectValue placeholder={items.length ? copy.choose : copy.none} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {items.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {error && <p className="text-[12.5px] text-destructive">{error}</p>}
      </div>
    </DialogShell>
  );
}
