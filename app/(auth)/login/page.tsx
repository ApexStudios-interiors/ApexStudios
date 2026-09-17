"use client";

import { Suspense, useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithPassword } from "@/features/auth/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/DialogShell";
import { Icon } from "@/components/ui/Icon";
import { safeNext } from "@/lib/auth/safe-next";

/**
 * The one sign-in screen for every role — owner, admin, site supervisor and
 * client alike (D51): username + password. There is no magic link and no
 * separate client sign-in. No two-factor step for any role (D48); the eye
 * button shows or hides what was typed.
 * Monochrome, same card/button treatment as the dialogs — this is the first
 * screen every user sees.
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

// Feather-style eye / eye-off, drawn through Icon's `path` prop rather than
// adding to components/ui's shared ICONS set.
const EYE = "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z";
const EYE_OFF =
  "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22";

function LoginForm() {
  const router = useRouter();
  // ?next= is attacker-controlled; only same-origin paths are followed.
  const next = safeNext(useSearchParams().get("next"));

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const login = useAction(signInWithPassword, {
    onSuccess: ({ data }) => {
      if (!data?.ok) return;
      router.push(next);
      router.refresh();
    },
  });

  return (
    <Card className="p-5">
      <h1 className="text-[17px] font-bold tracking-tight mb-4">Sign in</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.execute({ username, password });
        }}
        className="flex flex-col gap-3.5"
      >
        <Field label="Username" htmlFor="login-username">
          <input
            id="login-username"
            className={inputClass}
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </Field>
        {/* Not <Field>: the show/hide control sits beside the label, OUTSIDE
            the input. Inside the input's right edge it was covered by the
            autofill/key icon Safari, Chrome and password managers draw there. */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="login-password" className="block text-[12.5px] font-semibold">
              Password
            </label>
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-controls="login-password"
              aria-pressed={showPassword}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-foreground rounded-md px-1.5 py-0.5 hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon path={showPassword ? EYE_OFF : EYE} className="w-4 h-4" />
              {showPassword ? "Hide password" : "Show password"}
            </button>
          </div>
          <input
            id="login-password"
            className={inputClass}
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {(login.result.data?.ok === false || login.result.serverError) && (
          <p className="text-[12.5px] text-destructive">
            {login.result.data?.ok === false ? login.result.data.message : login.result.serverError}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="text-[12.5px] text-muted-foreground mt-4 text-center">
        Your username and password come from your Apex administrator.
      </p>
    </Card>
  );
}
