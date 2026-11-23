import Link from "next/link";

/**
 * Unmatched URLs outside any route (a mistyped address, an old bookmark).
 * Rendered inside the root layout only — there is no session here to build the
 * app shell from — so it is a small centred message with a way back, instead
 * of Next's bare "404" (APX-29, found live on 2026-11-23).
 */
export default function RootNotFound() {
  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="flex flex-col items-center text-center gap-3 max-w-[380px]">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">404</p>
        <h1 className="text-[20px] font-bold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="text-[13.5px] text-muted-foreground">Check the address, or go back to Apex Projects.</p>
        <Link href="/" className="underline text-foreground text-[13.5px]">
          Go to Apex Projects
        </Link>
      </div>
    </main>
  );
}
