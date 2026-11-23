"use client";

import { useId } from "react";

/**
 * "Needs my action" could not be read. Same contract as app/(app)/error.tsx
 * (code-standards §8: a generic message and the request id, never the raw
 * error), but scoped to this page so the shell — and the bell — stay usable.
 */
export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const fallbackId = useId();
  const requestId = error.digest ?? fallbackId;

  return (
    <div role="alert" className="flex flex-col items-center justify-center text-center gap-3 py-24">
      <h1 className="text-[17px] font-bold tracking-tight">Couldn&apos;t load what needs your action</h1>
      <p className="text-[13.5px] text-muted-foreground max-w-[360px]">
        We&apos;ve logged this. Try again; if it keeps happening, mention this reference when you ask for
        help.
      </p>
      <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{requestId}</code>
      <button onClick={reset} className="underline text-foreground text-[13.5px] mt-1">
        Try again
      </button>
    </div>
  );
}
