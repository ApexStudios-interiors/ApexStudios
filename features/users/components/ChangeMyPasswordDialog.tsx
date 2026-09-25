"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";
import { changeMyPasswordAction } from "@/features/users/actions";
import { changeMyPasswordSchema, PASSWORD_MIN_LENGTH } from "@/features/users/schema";
import type { ChangeMyPasswordRefusal } from "@/features/users/service";

/** What each server refusal reads as. None of them echoes a password. */
const REFUSAL_MESSAGE: Record<ChangeMyPasswordRefusal, string> = {
  no_email: "This account has no username to sign in with. Ask an admin for help.",
  same_as_current: "Choose a password different from your current one",
  wrong_password: "That isn't your current password",
};

/**
 * Change my password — opened from the user menu at the foot of the sidebar,
 * available to every signed-in role (owner, admin, site supervisor, client).
 *
 * It is the owner's only password path: D52 refuses a self-reset through the
 * admin Reset button, and D54 refuses an admin resetting the owner.
 *
 * The current password is required and is checked by re-authenticating on the
 * server (features/users/actions.ts). Neither password is kept after the
 * dialog closes: both live only in this component's state, and the action
 * returns neither.
 */
export function ChangeMyPasswordDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const change = useAction(changeMyPasswordAction, {
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.status === "refused") {
        setFieldError(REFUSAL_MESSAGE[data.reason]);
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setDone(true);
    },
  });

  const finish = () => {
    // The current session survives a self-service change; if it ever did not,
    // this refresh is what lands the user on /login instead of a dead page.
    router.refresh();
    onClose();
  };

  if (done) {
    return (
      <DialogShell
        title="Password changed"
        description="You are still signed in here. Every other device or browser signed in to this account has been signed out and will need the new password."
        okLabel="Done"
        onClose={finish}
        onOk={finish}
      >
        <p className="text-[13.5px] text-muted-foreground">Use the new password the next time you sign in.</p>
      </DialogShell>
    );
  }

  const submit = () => {
    const parsed = changeMyPasswordSchema.safeParse({ currentPassword, newPassword, confirmPassword });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Check the passwords");
      return;
    }
    setFieldError(null);
    change.execute(parsed.data);
  };

  return (
    <DialogShell
      title="Change my password"
      description="Confirm your current password, then choose a new one."
      okLabel={change.isPending ? "Changing…" : "Change password"}
      okPending={change.isPending}
      onClose={onClose}
      onOk={submit}
    >
      <form
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Current password" htmlFor="cmp-current">
          <input
            id="cmp-current"
            type="password"
            className={inputClass}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setFieldError(null);
            }}
          />
        </Field>
        <Field label="New password" hint={`At least ${PASSWORD_MIN_LENGTH} characters`} htmlFor="cmp-new">
          <input
            id="cmp-new"
            type="password"
            className={inputClass}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setFieldError(null);
            }}
          />
        </Field>
        <Field label="Repeat new password" htmlFor="cmp-confirm">
          <input
            id="cmp-confirm"
            type="password"
            className={inputClass}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setFieldError(null);
            }}
          />
        </Field>
        {fieldError && <p className="text-[12.5px] text-destructive">{fieldError}</p>}
        {change.result.serverError && (
          <p className="text-[12.5px] text-destructive">{change.result.serverError}</p>
        )}
      </form>
    </DialogShell>
  );
}
