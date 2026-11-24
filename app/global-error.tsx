"use client";

import "./globals.css";

/**
 * APX-52. The last-resort boundary: it replaces the ROOT layout when that
 * layout (or anything above app/(app)/error.tsx) throws, which used to end in
 * Next.js's unstyled default error page. Same contract as app/(app)/error.tsx
 * (code-standards §8): a generic message and the request reference, never the
 * raw error — Next.js logs the real one server-side under the same `digest`.
 *
 * It renders its own <html>/<body> because the root layout is gone when it
 * shows. The stylesheet is imported directly for the same reason; the theme
 * script is not re-run, so this page follows the OS colour scheme.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="font-sans text-sm leading-relaxed bg-background text-foreground">
        <title>Something went wrong — Apex Projects</title>
        <main className="flex flex-col items-center justify-center text-center gap-3 min-h-screen px-4">
          <h1 className="text-[17px] font-bold tracking-tight">Something went wrong</h1>
          <p className="text-[13.5px] text-muted-foreground max-w-[360px]">
            We&apos;ve logged this. If it keeps happening, mention this reference when you ask for help.
          </p>
          {error.digest && (
            <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{error.digest}</code>
          )}
          <button onClick={() => retry()} className="underline text-foreground text-[13.5px] mt-1">
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
