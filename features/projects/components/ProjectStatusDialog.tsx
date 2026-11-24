"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { setProjectStatus } from "@/features/projects/actions";
import {
  PROJECT_STATUS_MOVE_HINT,
  PROJECT_STATUS_TRANSITIONS,
  isProjectReopen,
  parseProjectStatus,
  projectStatusLabel,
  type ProjectStatus,
} from "@/features/projects/service";
import { DialogShell, Field, inputClass, textareaClass } from "@/components/ui/DialogShell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Change status (APX-11). Offers only the legal next statuses
 * (PROJECT_STATUS_TRANSITIONS); a reopen (completed → active, archived →
 * completed) asks for a reason, which goes into the audit row.
 * rpc_set_project_status decides again — this list is a convenience.
 */
export function ProjectStatusDialog({
  projectId,
  projectName,
  status,
}: {
  projectId: string;
  projectName: string;
  status: string;
}) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const from = parseProjectStatus(status) ?? "planning";
  const [to, setTo] = useState<ProjectStatus | null>(PROJECT_STATUS_TRANSITIONS[from][0] ?? null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const items = useMemo(
    () => PROJECT_STATUS_TRANSITIONS[from].map((s) => ({ value: s, label: projectStatusLabel(s) })),
    [from]
  );
  const reopen = to !== null && isProjectReopen(from, to);

  const change = useAction(setProjectStatus, {
    onSuccess: ({ data }) => {
      closeDialog();
      toast(`${projectName} is now ${projectStatusLabel(data?.status ?? to ?? from)}`);
      router.refresh();
    },
  });

  return (
    <DialogShell
      title="Change status"
      description={`${projectName} is ${projectStatusLabel(from)}.`}
      okLabel={change.isPending ? "Saving…" : "Change status"}
      okPending={change.isPending}
      okDisabled={!to}
      onClose={closeDialog}
      onOk={() => {
        if (!to) return;
        if (reopen && reason.trim() === "") {
          setReasonError("Say why the project is being reopened — it is kept in the audit log.");
          return;
        }
        setReasonError(null);
        change.execute({ id: projectId, status: to, ...(reopen ? { reason: reason.trim() } : {}) });
      }}
    >
      <div className="grid gap-3.5">
        <Field label="New status" htmlFor="ps-status">
          <Select
            items={items}
            value={to}
            onValueChange={(v: ProjectStatus | null) => {
              if (v) setTo(v);
            }}
          >
            <SelectTrigger id="ps-status" className={`${inputClass} w-full`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {items.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {to && <p className="text-[13px] text-muted-foreground -mt-1.5">{PROJECT_STATUS_MOVE_HINT[to]}</p>}
        {reopen && (
          <div>
            <Field label="Reason for reopening" htmlFor="ps-reason">
              <textarea
                id="ps-reason"
                className={textareaClass}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {reasonError && <p className="text-xs text-destructive mt-1">{reasonError}</p>}
          </div>
        )}
        {change.result.serverError && (
          <p className="text-[12.5px] text-destructive">{change.result.serverError}</p>
        )}
      </div>
    </DialogShell>
  );
}
