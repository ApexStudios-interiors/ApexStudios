import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/**
 * Rendered by notFound() anywhere inside the app shell — an unknown project or
 * package link, a deleted record. Before this file existed, notFound() thrown
 * from a project or package layout had no boundary to land in and surfaced as
 * "Something went wrong" (APX-28, found live on 2026-11-23). Same calm shape as
 * forbidden.tsx: what happened, and a way back.
 */
export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-24">
      <div className="w-11 h-11 rounded-full bg-muted grid place-items-center">
        <Icon
          path="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14zM8.5 11h5"
          className="w-5 h-5 text-muted-foreground"
        />
      </div>
      <h1 className="text-[17px] font-bold tracking-tight">We couldn&apos;t find that</h1>
      <p className="text-[13.5px] text-muted-foreground max-w-[360px]">
        The project or page in this link doesn&apos;t exist, or it has been removed. Check the link, or start
        again from your projects.
      </p>
      <Link href="/" className="underline text-foreground text-[13.5px]">
        Back to all projects
      </Link>
    </div>
  );
}
