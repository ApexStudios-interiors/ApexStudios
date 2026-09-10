"use client";

import { useAction } from "next-safe-action/hooks";
import { stopPreview } from "@/features/auth/impersonation-actions";
import { ROLE_LABEL } from "@/lib/rbac/roles";
import type { Role } from "@/lib/rbac/roles";

/**
 * D20: "A persistent banner across the top... It must be visually unmissable
 * and it must not be dismissible." No close button, no auto-hide — the only
 * way out is Exit preview, which really ends the preview.
 */
export function PreviewBanner({ role }: { role: Role }) {
  const stop = useAction(stopPreview);

  return (
    <div className="sticky top-0 z-[60] bg-foreground text-background px-4 py-2 flex items-center justify-center gap-3 text-[12.5px] font-medium">
      <span>Previewing as {ROLE_LABEL[role]}. Every write is refused while this is on.</span>
      <button
        onClick={() => stop.execute()}
        disabled={stop.isPending}
        className="underline underline-offset-2 disabled:opacity-60"
      >
        {stop.isPending ? "Exiting…" : "Exit preview"}
      </button>
    </div>
  );
}
