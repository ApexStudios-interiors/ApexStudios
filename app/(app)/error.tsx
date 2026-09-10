"use client";

import { useEffect, useId } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * code-standards §8: an unmapped exception becomes a generic message plus a
 * Sentry event, with the request id shown to the user — never a raw error, a
 * stack trace, or a blank page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const fallbackId = useId();
  const requestId = error.digest ?? fallbackId;

  useEffect(() => {
    Sentry.captureException(error, { extra: { requestId } });
  }, [error, requestId]);

  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-24">
      <h1 className="text-[17px] font-bold tracking-tight">Something went wrong</h1>
      <p className="text-[13.5px] text-muted-foreground max-w-[360px]">
        We&apos;ve logged this. If it keeps happening, mention this reference when you ask for help.
      </p>
      <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{requestId}</code>
      <button onClick={reset} className="underline text-foreground text-[13.5px] mt-1">
        Try again
      </button>
    </div>
  );
}
