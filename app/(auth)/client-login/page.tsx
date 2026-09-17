"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { requestMagicLink } from "@/features/auth/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/DialogShell";

const RESEND_COOLDOWN_S = 60;

/** D19: magic link only for v1. build/03-auth-and-rbac.md §2.7. */
export default function ClientLoginPage() {
  const [email, setEmail] = useState("");
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const request = useAction(requestMagicLink, {
    onSuccess: () => {
      setSentAt(Date.now());
      setCooldown(RESEND_COOLDOWN_S);
      const timer = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) {
            clearInterval(timer);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    },
  });

  if (sentAt) {
    return (
      <Card className="p-5 text-center">
        <h1 className="text-[17px] font-bold tracking-tight mb-1">Check your email</h1>
        <p className="text-[13px] text-muted-foreground">
          We sent a sign-in link to <span className="font-medium text-foreground">{email}</span>. It expires
          in 10 minutes.
        </p>
        <Button
          className="mt-4"
          disabled={cooldown > 0 || request.isPending}
          onClick={() => request.execute({ email })}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend link"}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h1 className="text-[17px] font-bold tracking-tight mb-1">Client sign in</h1>
      <p className="text-[13px] text-muted-foreground mb-4">
        We&apos;ll email you a link to sign in — no password needed.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          request.execute({ email });
        }}
        className="flex flex-col gap-3.5"
      >
        <Field label="Email" htmlFor="client-login-email">
          <input
            id="client-login-email"
            className={inputClass}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </Field>
        {request.result.serverError && (
          <p className="text-[12.5px] text-destructive">{request.result.serverError}</p>
        )}
        <Button type="submit" variant="primary" disabled={request.isPending}>
          {request.isPending ? "Sending…" : "Send link"}
        </Button>
      </form>
      <p className="text-[12.5px] text-muted-foreground mt-4 text-center">
        Staff?{" "}
        <a href="/login" className="underline text-foreground">
          Sign in with a password
        </a>
      </p>
    </Card>
  );
}
