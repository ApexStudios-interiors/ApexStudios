"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction } from "@/lib/safe-action";
import { requireRole } from "@/lib/auth/session";
import {
  addProjectMemberSchema,
  createClientSchema,
  createProjectSchema,
  previewProjectCodeSchema,
  setProjectStatusSchema,
  updateProjectSchema,
} from "./schema";
import { projectCodeBase } from "./service";

/**
 * build/04-projects-packages-phases.md §4.1: adminAction for all four, each
 * ending in revalidateTag('project:' + id) and revalidatePath('/'). No
 * business arithmetic here (AGENTS.md's layering rule) — createProject's only
 * non-trivial move, creating the project and its named packages atomically,
 * is pushed into rpc_create_project precisely because that atomicity can't be
 * expressed as two separate .insert() calls through PostgREST; everything
 * else here is a single-row, already-atomic write.
 *
 * Next 16 breaking change (AGENTS.md's header: heed deprecation notices):
 * `revalidateTag` now takes a required second `cacheLife` profile argument,
 * and its own doc comment says to use `updateTag` instead inside a Server
 * Action for immediate, read-your-own-writes expiration — exactly this case.
 * No route yet opts into "use cache"/cacheTag (that lands with a later
 * build's caching pass), so today this is a no-op with nothing tagged; it's
 * still called here so every mutating path already carries the right
 * invalidation call once caching is added.
 */

export const createProject = adminAction.inputSchema(createProjectSchema).action(async ({ parsedInput }) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_create_project", {
    p_name: parsedInput.name,
    p_client_id: parsedInput.clientId,
    // The base only — the RPC makes it unique within the org (migration
    // 20260917100001), including against soft-deleted projects RLS hides.
    p_code: projectCodeBase(parsedInput.name),
    // The generated Functions.Args type can't express nullability for a
    // scalar RPC parameter — information_schema.parameters carries no such
    // flag the way information_schema.columns does for table columns (see
    // scripts/gen-types.mjs) — but the column and this parameter both
    // genuinely accept null.
    p_location: (parsedInput.location ?? null) as unknown as string,
    p_start_date: parsedInput.startDate,
    p_package_names: parsedInput.packages,
  });
  if (error) throw new Error(error.message);

  updateTag(`project:${data}`);
  revalidatePath("/");
  return { id: data as string };
});

/**
 * What createProject would generate right now, for the dialog's read-only
 * Project Code field. A preview, not a reservation: rpc_create_project decides
 * again inside its own transaction.
 */
export const previewProjectCode = adminAction
  .inputSchema(previewProjectCodeSchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rpc_next_project_code", {
      p_base: projectCodeBase(parsedInput.name),
    });
    if (error) throw new Error(error.message);
    return { code: data };
  });

/**
 * The Client combobox's inline "Create «name»". Same guard as every other
 * client write path: `clients_insert` (migration 0003) allows owner/admin in
 * their own org, which is exactly adminAction plus the session's org_id.
 */
export const createClientRecord = adminAction
  .inputSchema(createClientSchema)
  .action(async ({ parsedInput, ctx }) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .insert({ org_id: ctx.session.orgId, name: parsedInput.name })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);

    revalidatePath("/");
    return data;
  });

export const updateProject = adminAction.inputSchema(updateProjectSchema).action(async ({ parsedInput }) => {
  const { id, ...patch } = parsedInput;
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.location !== undefined && { location: patch.location }),
      ...(patch.targetEndDate !== undefined && { target_end_date: patch.targetEndDate }),
      ...(patch.contractValue !== undefined && { contract_value: Number(patch.contractValue) }),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  updateTag(`project:${id}`);
  revalidatePath("/");
  // 'layout': every route under this project (dashboard, packages,
  // package detail) can render fields this action changes.
  revalidatePath(`/projects/${id}`, "layout");
  return { ok: true as const };
});

export const setProjectStatus = adminAction
  .inputSchema(setProjectStatusSchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("projects")
      .update({ status: parsedInput.status })
      .eq("id", parsedInput.id);
    if (error) throw new Error(error.message);

    updateTag(`project:${parsedInput.id}`);
    revalidatePath("/");
    revalidatePath(`/projects/${parsedInput.id}`, "layout");
    return { ok: true as const };
  });

export const addProjectMember = adminAction
  .inputSchema(addProjectMemberSchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("project_members")
      .insert({ project_id: parsedInput.projectId, profile_id: parsedInput.profileId });
    if (error) throw new Error(error.message);

    updateTag(`project:${parsedInput.projectId}`);
    revalidatePath("/");
    revalidatePath(`/projects/${parsedInput.projectId}`, "layout");
    return { ok: true as const };
  });

/**
 * A plain Server Action (not a next-safe-action client, matching
 * features/auth/actions.ts's `signOut`) — this reads, it doesn't mutate, and
 * `clients` is admin-only on select (0003), so `AddProjectDialog`'s Client
 * field needs a real fetch rather than the prototype's single hard-coded
 * name. `clients` is small (one org, a handful of clients); no pagination.
 */
export async function getClientOptions(): Promise<{ id: string; name: string }[]> {
  "use server";
  await requireRole(["owner", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}
