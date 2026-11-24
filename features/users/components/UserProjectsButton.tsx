"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addProjectMember, removeProjectMember } from "@/features/projects/actions";
import type { ClientProjectDTO, ProjectOptionDTO } from "@/features/projects/queries";
import {
  MEMBER_GRANT_REFUSAL_COPY,
  MEMBER_REMOVAL_REFUSAL_COPY,
  lastProjectRemovalNote,
  type MemberRole,
} from "@/features/projects/service";
import { projectPath } from "@/lib/routing/paths";

/**
 * Projects, on a client's or a Site Supervisor's row of the Users page: the
 * projects this login can see, each with Remove, and Add to project for one
 * it cannot see yet — the same addProjectMember / removeProjectMember the
 * project's Client access and Site team cards use, so the same rule applies
 * (APX-12 generalised the client-only version). Remove asks to confirm in
 * place, on that project's row; on their only project the confirm also says
 * they will see no project until given one again (2026-11-23).
 */
export function UserProjectsButton({
  role,
  profileId,
  fullName,
  projects,
  allProjects,
}: {
  role: MemberRole;
  profileId: string;
  fullName: string;
  projects: ClientProjectDTO[];
  /** The org's non-archived projects; the ones not in `projects` are offered. */
  allProjects: ProjectOptionDTO[];
}) {
  const router = useRouter();
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [addId, setAddId] = useState<string | null>(null);
  const [refusalText, setRefusalText] = useState<string | null>(null);

  const addable = useMemo(() => {
    const mine = new Set(projects.map((p) => p.id));
    return allProjects.filter((p) => !mine.has(p.id)).map((p) => ({ value: p.id, label: p.name }));
  }, [projects, allProjects]);

  const remove = useAction(removeProjectMember, {
    onSuccess: ({ data, input }) => {
      if (data?.status === "refused") {
        setRefusalText(MEMBER_REMOVAL_REFUSAL_COPY[data.reason]);
        return;
      }
      const name = projects.find((p) => p.id === input.projectId)?.name ?? "the project";
      setConfirmingId(null);
      toast(`${fullName} removed from ${name}`);
      router.refresh();
    },
  });

  const add = useAction(addProjectMember, {
    onSuccess: ({ data, input }) => {
      if (data?.status === "refused") {
        setRefusalText(MEMBER_GRANT_REFUSAL_COPY[data.reason]);
        return;
      }
      const name = allProjects.find((p) => p.id === input.projectId)?.name ?? "the project";
      setAddId(null);
      toast(
        data?.status === "already_member"
          ? `${fullName} can already see ${name}`
          : `${fullName} added to ${name}`
      );
      router.refresh();
    },
  });

  const busy = remove.isPending || add.isPending;
  const error = refusalText ?? remove.result.serverError ?? add.result.serverError;

  const reset = () => {
    remove.reset();
    add.reset();
    setRefusalText(null);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          reset();
          setConfirmingId(null);
          setAddId(null);
          setOpen(true);
        }}
      >
        Projects ({projects.length})
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{fullName}&apos;s projects</DialogTitle>
            <DialogDescription>
              {role === "client"
                ? `${fullName} sees only these projects. Remove takes them off that project only; their login and other projects stay.`
                : `As a Site Supervisor, ${fullName} sees only these projects and can post updates, raise stock requests and update tasks on them. Remove takes them off that project only.`}
            </DialogDescription>
          </DialogHeader>

          {projects.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground">
              {role === "client"
                ? "This client can't see any project."
                : "Not on any project yet, so they see an empty app. Add them to one below."}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {projects.map((p) => (
                <li key={p.id} className="px-3 py-2 flex items-center gap-2 text-[13.5px]">
                  {confirmingId === p.id ? (
                    <>
                      <span className="font-medium">Remove from {p.name}?</span>
                      <span className="ml-auto flex gap-1">
                        <Button
                          variant="default"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirmingId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => remove.execute({ projectId: p.id, profileId, expectedRole: role })}
                        >
                          {remove.isPending ? "Removing…" : "Remove"}
                        </Button>
                      </span>
                    </>
                  ) : (
                    <>
                      <Link
                        href={projectPath(p)}
                        onClick={() => setOpen(false)}
                        className="font-medium hover:underline underline-offset-2"
                      >
                        {p.name}
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        disabled={busy}
                        onClick={() => {
                          reset();
                          setConfirmingId(p.id);
                        }}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {confirmingId && projects.length === 1 && (
            <p className="text-[13px] font-medium">{lastProjectRemovalNote(role)}</p>
          )}

          {addable.length > 0 && (
            <div className="flex items-center gap-2">
              <Select items={addable} value={addId} onValueChange={(v) => setAddId(v)} disabled={busy}>
                <SelectTrigger aria-label="Project to add" className="h-9 flex-1 text-[13.5px]">
                  <SelectValue placeholder="Add to project…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {addable.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                variant="default"
                size="sm"
                disabled={!addId || busy}
                onClick={() => {
                  reset();
                  if (addId) add.execute({ projectId: addId, profileId, expectedRole: role });
                }}
              >
                {add.isPending ? "Adding…" : "Add"}
              </Button>
            </div>
          )}

          {error && <p className="text-[12.5px] text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="default" disabled={busy} />}>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
