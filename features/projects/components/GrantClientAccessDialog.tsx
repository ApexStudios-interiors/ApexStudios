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

/**
 * D51: give an existing client login access to this project too — one client
 * company often has several projects. A thin form over addProjectMember; the
 * options are the org's client logins that are not yet members, read by the
 * page (getProjectClientAccess) and passed in.
 */
export function GrantClientAccessDialog({
  projectId,
  projectName,
  clients,
}: {
  projectId: string;
  projectName: string;
  clients: ClientLoginDTO[];
}) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [profileId, setProfileId] = useState<string | null>(null);

  const items = clients.map((c) => ({
    value: c.id,
    label: c.email ? `${c.fullName} (${c.email})` : c.fullName,
  }));

  const grant = useAction(addProjectMember, {
    onSuccess: ({ data }) => {
      toast(data?.status === "already_member" ? "Already has access" : "Access granted");
      router.refresh();
      closeDialog();
    },
  });

  return (
    <DialogShell
      title="Add existing client"
      description={`Choose a client login that should also see ${projectName}.`}
      okLabel={grant.isPending ? "Adding…" : "Give access"}
      okDisabled={grant.isPending || !profileId}
      onClose={closeDialog}
      onOk={() => {
        if (profileId) grant.execute({ projectId, profileId });
      }}
    >
      <div className="grid gap-3.5">
        <Field label="Client login" htmlFor="gca-client">
          <Select
            items={items}
            value={profileId}
            onValueChange={(v) => setProfileId(v)}
            disabled={items.length === 0}
          >
            <SelectTrigger id="gca-client" className={`${inputClass} w-full`}>
              <SelectValue placeholder={items.length ? "Select a client login" : "No other client logins"} />
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
        {grant.result.serverError && (
          <p className="text-[12.5px] text-destructive">{grant.result.serverError}</p>
        )}
      </div>
    </DialogShell>
  );
}
