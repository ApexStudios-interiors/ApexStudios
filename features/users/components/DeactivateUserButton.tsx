"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
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
import { setUserActive } from "@/features/users/actions";
import type { UserAdminRefusal } from "@/features/users/service";
import { USER_ADMIN_REFUSAL_TITLE } from "./refusal-copy";

/**
 * Deactivate, and its undo. This replaces the prototype's "Remove", which was
 * a toast and nothing else: a user is never deleted (AGENTS.md database rule 7
 * — the audit trail, the stock ledger and every bill reference the profile),
 * so what the control really does is switch `is_active` off, end the account's
 * sessions and ban it in GoTrue so it cannot sign back in. All three are
 * undone by pressing Reactivate.
 *
 * Whether it is enabled comes from the same rule the server enforces
 * (activeChangeRefusal); the action, the RPC and the trigger on `profiles`
 * check it again, including the last-active-owner invariant, which the UI can
 * only ever be a hint about.
 */
export function DeactivateUserButton({
  userId,
  fullName,
  isActive,
  refusal,
}: {
  userId: string;
  fullName: string;
  isActive: boolean;
  refusal: UserAdminRefusal | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  const change = useAction(setUserActive, {
    onSuccess: () => {
      setConfirming(false);
      router.refresh();
    },
  });

  const verb = isActive ? "Deactivate" : "Reactivate";

  return (
    <>
      {/* The title sits on a wrapper: a disabled Button has pointer-events-none, so its own would never show. */}
      <span className="inline-flex" title={refusal ? USER_ADMIN_REFUSAL_TITLE[refusal] : undefined}>
        <Button
          variant="ghost"
          size="sm"
          disabled={refusal !== null}
          onClick={() => {
            change.reset();
            setConfirming(true);
          }}
        >
          {verb}
        </Button>
      </span>

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!change.isPending) setConfirming(open);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {verb} {fullName}?
            </DialogTitle>
            <DialogDescription>
              {isActive
                ? `${fullName} is signed out everywhere and cannot sign in again. Their work, updates and history stay exactly as they are, and you can reactivate them here at any time.`
                : `${fullName} can sign in again with their existing password and gets their old access back.`}
            </DialogDescription>
          </DialogHeader>
          {change.result.serverError && (
            <p className="text-[12.5px] text-destructive">{change.result.serverError}</p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="default" disabled={change.isPending} />}>
              Cancel
            </DialogClose>
            <Button
              variant={isActive ? "destructive" : "primary"}
              disabled={change.isPending}
              onClick={() => change.execute({ userId, isActive: !isActive })}
            >
              {change.isPending ? `${verb.slice(0, -1)}ing…` : verb}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
