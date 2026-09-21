"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction } from "@/lib/safe-action";
import { requireRole, requireSession } from "@/lib/auth/session";
import {
  addProjectMemberSchema,
  createClientSchema,
  createProjectSchema,
  previewProjectCodeSchema,
  setProjectRateVisibilitySchema,
  setProjectStatusSchema,
  updateProjectSchema,
} from "./schema";
import { parseRateVisibility, projectCodeBase, type RateVisibility } from "./service";
import { insertProjectMember } from "./members";

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

/**
 * D55 — whether a Site Supervisor may see and enter the per-unit Rate on a
 * stock request for this project. `adminAction` is the guard here and
 * `projects_update` (migration 0004) is the guard in the database; the column's
 * own check constraint refuses anything outside the three modes.
 */
export const setProjectRateVisibility = adminAction
  .inputSchema(setProjectRateVisibilitySchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("projects")
      .update({ rate_visibility: parsedInput.rateVisibility })
      .eq("id", parsedInput.id);
    if (error) throw new Error(error.message);

    updateTag(`project:${parsedInput.id}`);
    revalidatePath(`/projects/${parsedInput.id}`, "layout");
    return { ok: true as const };
  });

/**
 * The same setting, read by `NewRequestDialog` so the form knows whether to
 * render the Rate field for a site supervisor (D55). A plain Server Action,
 * like `getClientOptions` above and the stock dialog's other option loaders:
 * this reads, it does not mutate.
 *
 * Readable by any member of the project — `projects_select` already allows it,
 * and the mode itself carries no money, only a policy about who may type one.
 * It is NOT the enforcement: `createStockRequest` re-reads it server-side and
 * `rpc_create_stock_request` decides again inside the write.
 */
export async function getProjectRateVisibility(projectId: string): Promise<RateVisibility> {
  "use server";
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("rate_visibility")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseRateVisibility(data?.rate_visibility);
}

/**
 * Grants an existing profile access to a project (CAN.manageProjectMembers).
 * The project dashboard's Client access card uses it to give an existing
 * client login a further project (D51) — one client company often has
 * several. Returns `already_member` rather than an error for a repeat grant.
 */
export const addProjectMember = adminAction
  .inputSchema(addProjectMemberSchema)
  .action(async ({ parsedInput, ctx }) => {
    const supabase = await createClient();
    const status = await insertProjectMember(supabase, {
      projectId: parsedInput.projectId,
      profileId: parsedInput.profileId,
      addedBy: ctx.session.userId,
    });

    updateTag(`project:${parsedInput.projectId}`);
    revalidatePath("/");
    revalidatePath(`/projects/${parsedInput.projectId}`, "layout");
    return { status };
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
