"use client";

import { useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { ALLOWED_SECTIONS, sectionFromPath } from "@/lib/rbac/nav";

/**
 * UX only — layout.tsx does the SECURITY check (requireProjectAccess,
 * server-side) before this ever renders (02-lld.md §8.2).
 *
 * No longer gates on `data.projects.some(...)` (the mock array): a project
 * created through the real `createProject` action has no entry there and
 * never will, so that check said "not found" for a project that genuinely
 * exists and the layout has already confirmed access to. The real
 * not-found case belongs to whichever page renders — most already call
 * `notFound()` themselves once their own real query returns nothing.
 */
export function ProjectShell({ children }: { children: React.ReactNode }) {
  const params = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { role, setLastProjectId } = useApp();
  const projectId = params.projectId;

  useEffect(() => {
    setLastProjectId(projectId);
  }, [projectId, setLastProjectId]);

  // Redirect away from a section this role isn't allowed to view (e.g. after
  // switching roles while parked on a page the new role can't access).
  useEffect(() => {
    const section = sectionFromPath(pathname, projectId);
    if (!ALLOWED_SECTIONS[role].includes(section)) {
      router.replace(`/projects/${projectId}`);
    }
  }, [pathname, projectId, role, router]);

  return <>{children}</>;
}
