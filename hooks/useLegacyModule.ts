"use client";

import { useParams } from "next/navigation";
import { useProject } from "./useProject";
import type { ModuleT, Project } from "@/lib/types";

/**
 * The mock `ModuleT` for the current `/packages/[moduleId]` route, for the
 * four tabs still on `AppContext` (Schedule, Updates, Stock, Billing —
 * build/04-projects-packages-phases.md §4.4 step 4 converts Budget only).
 *
 * Unlike `useProject`, a missing match here is NOT a bug to throw on: a
 * package created through the real `createPackage` action after this build
 * has a real database row and a working Budget tab, but no entry in
 * `lib/data.ts`'s mock modules array — there is nothing to seed it with. Its
 * other four tabs render "not available yet" instead of the real content
 * until Builds 05-09 convert them, rather than crashing the whole page.
 */
export function useLegacyModule(): { project: Project; module: ModuleT | undefined } {
  const params = useParams<{ moduleId: string }>();
  const project = useProject();
  return { project, module: project.modules.find((m) => m.id === params.moduleId) };
}
