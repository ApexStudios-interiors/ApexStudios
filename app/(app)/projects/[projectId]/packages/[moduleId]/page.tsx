import { redirect } from "next/navigation";

/**
 * 02-lld.md §8.1: package tabs are routes now, with this segment redirecting
 * to the default tab so a bookmarked `/packages/:moduleId` URL still lands
 * somewhere real. Budget is the default for every role — labeled "Phases" for
 * non-Admin, but the same route.
 */
export default async function ModuleDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; moduleId: string }>;
}) {
  const { projectId, moduleId } = await params;
  redirect(`/projects/${projectId}/packages/${moduleId}/budget`);
}
