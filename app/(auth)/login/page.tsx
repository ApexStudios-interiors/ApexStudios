"use client";

import { Suspense, useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithPassword, verifyTotp } from "@/features/auth/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/DialogShell";

/**
 * Staff email + password, with a TOTP challenge step when enrolled
 * (build/03-auth-and-rbac.md §2.7). Monochrome, same card/button treatment as
 * the dialogs — this is the first screen every user sees.
 *
 * Wrapped in Suspense: useSearchParams() otherwise bails the whole page out of
 * static prerendering (Next.js requires the boundary so it can render a static
 * shell and fill in the search-param-dependent part on the client).
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState<{ factorId: string; challengeId: string } | null>(null);

  const login = useAction(signInWithPassword, {
    onSuccess: ({ data }) => {
      if (data?.needsMfa) {
        setMfa({ factorId: data.factorId, challengeId: data.challengeId });
      } else {
        router.push(next);
        router.refresh();
      }
    },
  });

  const verify = useAction(verifyTotp, {
    onSuccess: () => {
      router.push(next);
      router.refresh();
    },
  });

  if (mfa) {
    return (
      <Card className="p-5">
        <h1 className="text-[17px] font-bold tracking-tight mb-1">Enter your code</h1>
        <p className="text-[13px] text-muted-foreground mb-4">
          Open your authenticator app and enter the 6-digit code.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify.execute({ factorId: mfa.factorId, challengeId: mfa.challengeId, code });
          }}
          className="flex flex-col gap-3.5"
        >
          <Field label="Code" htmlFor="login-totp-code">
            <input
              id="login-totp-code"
              className={inputClass}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
          </Field>
          {verify.result.serverError && (
            <p className="text-[12.5px] text-destructive">{verify.result.serverError}</p>
          )}
          <Button type="submit" variant="primary" disabled={verify.isPending}>
            {verify.isPending ? "Verifying…" : "Verify"}
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h1 className="text-[17px] font-bold tracking-tight mb-4">Sign in</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.execute({ email, password });
        }}
        className="flex flex-col gap-3.5"
      >
        <Field label="Email" htmlFor="login-email">
          <input
            id="login-email"
            className={inputClass}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Password" htmlFor="login-password">
          <input
            id="login-password"
            className={inputClass}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {login.result.serverError && (
          <p className="text-[12.5px] text-destructive">{login.result.serverError}</p>
        )}
        <Button type="submit" variant="primary" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="text-[12.5px] text-muted-foreground mt-4 text-center">
        Client?{" "}
        <a href="/client-login" className="underline text-foreground">
          Sign in with a magic link
        </a>
      </p>
    </Card>
  );
}
