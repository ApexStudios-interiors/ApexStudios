"use client";

import { useState } from "react";
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
import {
  MEMBER_REMOVAL_REFUSAL_COPY,
  lastProjectRemovalNote,
  type MemberRole,
} from "@/features/projects/service";

/**
 * Remove, on a row of the project's Client access card or Site team card:
 * takes that client login or Site Supervisor off THIS project only. Their
 * login and their other projects are untouched; the card's Add button gives
 * the access back.
 *
 * Always available, including on the member's only project (2026-11-23); the
 * confirm step then says they will see no project until given one again.
 * removeProjectMember still refuses an admin, a non-member or the other role
 * on the server (memberRemovalRefusal).
 */
export function RemoveProjectMemberButton({
  role,
  projectId,
  projectName,
  profileId,
  fullName,
  projectCount,
  onlyMemberOnProject,
}: {
  role: MemberRole;
  projectId: string;
  projectName: string;
  profileId: string;
  fullName: string;
  projectCount: number;
  onlyMemberOnProject: boolean;
}) {
  const router = useRouter();
  const { toast } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [refusalText, setRefusalText] = useState<string | null>(null);

  const remove = useAction(removeProjectMember, {
    onSuccess: ({ data }) => {
      if (data?.status === "refused") {
        setRefusalText(MEMBER_REMOVAL_REFUSAL_COPY[data.reason]);
        return;
      }
      setConfirming(false);
      toast(`${fullName} removed from ${projectName}`);
      router.refresh();
    },
  });

  const giveBack = role === "client" ? "Add existing client" : "Add site supervisor";
  const onlyNote =
    role === "client"
      ? " They are this project's only client: approvals and bills waiting for a client will wait until another client is given access."
      : " They are this project's only site supervisor: nobody on site will see it until another is added.";

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          remove.reset();
          setRefusalText(null);
          setConfirming(true);
        }}
      >
        Remove
      </Button>

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!remove.isPending) setConfirming(open);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove {fullName} from this project?</DialogTitle>
            <DialogDescription>
              {fullName} will no longer see {projectName}. Their login and their other projects stay as they
              are, and you can give access back with {giveBack}.{onlyMemberOnProject && onlyNote}
            </DialogDescription>
            {projectCount <= 1 && (
              <p className="text-[13px] font-medium text-foreground">{lastProjectRemovalNote(role)}</p>
            )}
          </DialogHeader>
          {(refusalText ?? remove.result.serverError) && (
            <p className="text-[12.5px] text-destructive">{refusalText ?? remove.result.serverError}</p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="default" disabled={remove.isPending} />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.execute({ projectId, profileId, expectedRole: role })}
            >
              {remove.isPending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
