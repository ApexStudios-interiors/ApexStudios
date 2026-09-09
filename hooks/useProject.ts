"use client";

import { useParams } from "next/navigation";
import { useApp } from "@/context/AppContext";
import type { Project } from "@/lib/types";

/**
 * The project for the current `/projects/[projectId]` route.
 *
 * `app/projects/[projectId]/layout.tsx` renders "Project not found" and does
 * not render children when the id does not resolve, so by the time any page in
 * this segment runs the project exists. That invariant is invisible to the type
 * system. Encoding it here once, with a real error, is what lets every page in
 * the segment drop its non-null assertion — `../AGENTS.md` forbids `!`.
 */
export function useProject(): Project {
  const params = useParams<{ projectId: string }>();
  const { data } = useApp();
  const project = data.projects.find((p) => p.id === params.projectId);
  if (!project) {
    throw new Error(
      `useProject: no project "${params.projectId}". The [projectId] layout guard should have prevented this render.`
    );
  }
  return project;
}
