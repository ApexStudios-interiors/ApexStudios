"use client";

import { usePathname } from "next/navigation";

/**
 * The canonical `/projects/<code>` for the project currently on screen.
 *
 * A rewrite does not change the address bar, so the browser's path is already
 * the readable one even though the server saw ids — which means a client
 * component can read it straight off `usePathname()` and needs nothing passed
 * down.
 *
 * Falls back to the id form when the current path is not inside a project
 * (a dialog opened from the portfolio, say). That link still works; it just
 * costs the redirect, which is the right trade for the case where there is
 * genuinely no canonical form to hand.
 */
export function useProjectBase(projectId: string): string {
  const pathname = usePathname();
  const seg = /^\/projects\/([^/]+)/.exec(pathname ?? "")?.[1];
  return `/projects/${seg || projectId}`;
}
