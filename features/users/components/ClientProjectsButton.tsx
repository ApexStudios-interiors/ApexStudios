"use client";

import { useState } from "react";
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
import { removeProjectMember } from "@/features/projects/actions";
import type { ClientProjectDTO } from "@/features/projects/queries";
import { CLIENT_ACCESS_REMOVAL_REFUSAL_COPY, clientAccessRemovalRefusal } from "@/features/projects/service";
import { projectPath } from "@/lib/routing/paths";

/**
 * Projects, on a client row of the Users page: the projects this client login
 * can see, each with Remove — the same removeProjectMember the project's
 * Client access card uses, so the same rule applies (not their last project,
 * D51). Remove asks to confirm in place, on that project's row.
 */
export function ClientProjectsButton({
  profileId,
  fullName,
  projects,
}: {
  profileId: string;
  fullName: string;
  projects: ClientProjectDTO[];
}) {
  const router = useRouter();
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [refusalText, setRefusalText] = useState<string | null>(null);

  const refusal = clientAccessRemovalRefusal({
    role: "client",
    isMember: true,
    projectCount: projects.length,
  });

  const remove = useAction(removeProjectMember, {
    onSuccess: ({ data, input }) => {
      if (data?.status === "refused") {
        setRefusalText(CLIENT_ACCESS_REMOVAL_REFUSAL_COPY[data.reason]);
        return;
      }
      const name = projects.find((p) => p.id === input.projectId)?.name ?? "the project";
      setConfirmingId(null);
      toast(`${fullName} removed from ${name}`);
      router.refresh();
    },
  });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          remove.reset();
          setRefusalText(null);
          setConfirmingId(null);
          setOpen(true);
        }}
      >
        Projects ({projects.length})
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!remove.isPending) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{fullName}&apos;s projects</DialogTitle>
            <DialogDescription>
              Remove takes {fullName} off that project only; their login and other projects stay. To give
              access to another project, use Add existing client on that project&apos;s Client access card.
            </DialogDescription>
          </DialogHeader>

          {projects.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground">This client can&apos;t see any project.</p>
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
                          disabled={remove.isPending}
                          onClick={() => setConfirmingId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={remove.isPending}
                          onClick={() => remove.execute({ projectId: p.id, profileId })}
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
                      <span
                        className="ml-auto inline-flex"
                        title={refusal ? CLIENT_ACCESS_REMOVAL_REFUSAL_COPY[refusal] : undefined}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={refusal !== null || remove.isPending}
                          onClick={() => {
                            remove.reset();
                            setRefusalText(null);
                            setConfirmingId(p.id);
                          }}
                        >
                          Remove
                        </Button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {(refusalText ?? remove.result.serverError) && (
            <p className="text-[12.5px] text-destructive">{refusalText ?? remove.result.serverError}</p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="default" disabled={remove.isPending} />}>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
