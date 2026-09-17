"use client";

import { useState } from "react";
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
import { resetUserPassword } from "@/features/users/actions";
import type { ResetRefusal } from "@/features/users/service";
import { CreatedCredentialsDialog, type CreatedCredentials } from "./CreatedCredentialsDialog";

/** Why the button is disabled on a row, for its tooltip. */
const REFUSAL_TITLE: Record<ResetRefusal, string> = {
  not_found: "This user no longer exists.",
  self: "You can't reset your own password here.",
  forbidden_role: "Only the owner can reset an owner's or an admin's password.",
  inactive: "This user is deactivated.",
  no_email: "This user has no username to sign in with.",
};

/**
 * Reset password (D52), one per Users row. Whether it is enabled comes from
 * the same rule the server enforces (passwordResetRefusal), but disabling it
 * is a courtesy only — resetUserPassword and rpc_record_password_reset both
 * check again.
 *
 * Confirm first, then show the new password once in the same
 * CreatedCredentialsDialog as Add User. Closing it drops the password from
 * this component's state and from the action hook's stored result.
 */
export function ResetPasswordButton({
  userId,
  fullName,
  refusal,
}: {
  userId: string;
  fullName: string;
  refusal: ResetRefusal | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [created, setCreated] = useState<CreatedCredentials | null>(null);

  const reset = useAction(resetUserPassword, {
    onSuccess: ({ data }) => {
      if (!data) return;
      setConfirming(false);
      setCreated({ username: data.username, email: data.email, password: data.password });
    },
  });

  const closeCredentials = () => {
    setCreated(null);
    reset.reset();
  };

  return (
    <>
      {/* The title sits on a wrapper: a disabled Button has pointer-events-none, so its own would never show. */}
      <span className="inline-flex" title={refusal ? REFUSAL_TITLE[refusal] : undefined}>
        <Button
          variant="ghost"
          size="sm"
          disabled={refusal !== null}
          onClick={() => {
            reset.reset();
            setConfirming(true);
          }}
        >
          Reset password
        </Button>
      </span>

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!reset.isPending) setConfirming(open);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Reset password for {fullName}?</DialogTitle>
            <DialogDescription>
              A new password is generated and shown to you once. {fullName}&apos;s current password stops
              working immediately, and they are signed out everywhere.
            </DialogDescription>
          </DialogHeader>
          {reset.result.serverError && (
            <p className="text-[12.5px] text-destructive">{reset.result.serverError}</p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="default" disabled={reset.isPending} />}>Cancel</DialogClose>
            <Button variant="primary" disabled={reset.isPending} onClick={() => reset.execute({ userId })}>
              {reset.isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {created && (
        <CreatedCredentialsDialog title="Password reset" created={created} onClose={closeCredentials} />
      )}
    </>
  );
}
