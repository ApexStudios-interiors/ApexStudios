import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/**
 * Rendered by next/navigation's forbidden() (next.config.ts experimental.authInterrupts).
 * build/03-auth-and-rbac.md §2.11: a plain, calm explanation and a link home —
 * not a stack trace, not a blank page.
 */
export default function Forbidden() {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-24">
      <div className="w-11 h-11 rounded-full bg-muted grid place-items-center">
        <Icon
          path="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM8 11V7a4 4 0 118 0v4"
          className="w-5 h-5 text-muted-foreground"
        />
      </div>
      <h1 className="text-[17px] font-bold tracking-tight">You don&apos;t have access to this</h1>
      <p className="text-[13.5px] text-muted-foreground max-w-[360px]">
        Your role doesn&apos;t include this page. If you think that&apos;s wrong, ask an admin to check your
        project access.
      </p>
      <Link href="/" className="underline text-foreground text-[13.5px]">
        Back to all projects
      </Link>
    </div>
  );
}
