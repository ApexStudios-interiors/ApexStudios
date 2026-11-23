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
import { CLIENT_ACCESS_REMOVAL_REFUSAL_COPY, clientAccessRemovalRefusal } from "@/features/projects/service";

/**
 * Remove, on a client row of the project's Client access card: takes that
 * client login off THIS project only. Their login and their other projects are
 * untouched; Add existing client gives the access back.
 *
 * Disabled, with the reason as its tooltip, when this is the client's only
 * project (D51) — removeProjectMember applies the same rule again on the
 * server, so the button is only ever a hint.
 */
export function RemoveClientAccessButton({
  projectId,
  projectName,
  profileId,
  fullName,
  projectCount,
  onlyClientOnProject,
}: {
  projectId: string;
  projectName: string;
  profileId: string;
  fullName: string;
  projectCount: number;
  onlyClientOnProject: boolean;
}) {
  const router = useRouter();
  const { toast } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [refusalText, setRefusalText] = useState<string | null>(null);

  const refusal = clientAccessRemovalRefusal({ role: "client", isMember: true, projectCount });

  const remove = useAction(removeProjectMember, {
    onSuccess: ({ data }) => {
      if (data?.status === "refused") {
        setRefusalText(CLIENT_ACCESS_REMOVAL_REFUSAL_COPY[data.reason]);
        return;
      }
      setConfirming(false);
      toast(`${fullName} removed from ${projectName}`);
      router.refresh();
    },
  });

  return (
    <>
      {/* The title sits on a wrapper: a disabled Button has pointer-events-none, so its own would never show. */}
      <span className="inline-flex" title={refusal ? CLIENT_ACCESS_REMOVAL_REFUSAL_COPY[refusal] : undefined}>
        <Button
          variant="ghost"
          size="sm"
          disabled={refusal !== null}
          onClick={() => {
            remove.reset();
            setRefusalText(null);
            setConfirming(true);
          }}
        >
          Remove
        </Button>
      </span>

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
              are, and you can give access back with Add existing client.
              {onlyClientOnProject &&
                " They are this project's only client: approvals and bills waiting for a client will wait until another client is given access."}
            </DialogDescription>
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
              onClick={() => remove.execute({ projectId, profileId })}
            >
              {remove.isPending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
