"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { verifyTotpCode } from "@/features/auth/actions";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/DialogShell";

/**
 * The 6-digit code step shared by both /mfa screens: confirming a factor just
 * enrolled, and answering a challenge for an existing one. A correct code
 * upgrades the session to aal2 server-side, so the refresh after the push is
 * what lets the app shell see it.
 */
export function TotpCodeForm({
  factorId,
  next,
  submitLabel,
}: {
  factorId: string;
  next: string;
  submitLabel: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");

  const verify = useAction(verifyTotpCode, {
    onSuccess: () => {
      router.push(next);
      router.refresh();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        verify.execute({ factorId, code });
      }}
      className="flex flex-col gap-3.5"
    >
      <Field label="6-digit code" htmlFor="mfa-totp-code">
        <input
          id="mfa-totp-code"
          className={inputClass}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          autoFocus
        />
      </Field>
      {(verify.result.serverError ?? verify.result.validationErrors) && (
        <p className="text-[12.5px] text-destructive">
          {verify.result.serverError ?? "Enter the 6-digit code from your authenticator app."}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={verify.isPending || code.length !== 6}>
        {verify.isPending ? "Verifying…" : submitLabel}
      </Button>
    </form>
  );
}
