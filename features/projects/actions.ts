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
  removeProjectMemberSchema,
  setProjectRateVisibilitySchema,
  setProjectStatusSchema,
  updateProjectSchema,
} from "./schema";
import {
  isSameProjectName,
  normalisePackageNames,
  parseProjectStatus,
  parseRateVisibility,
  projectCodeBase,
  projectEditRefusal,
  type ProjectStatus,
  type RateVisibility,
} from "./service";
import { deleteProjectMember, insertProjectMember } from "./members";

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
    // Blanks and within-submission duplicates dropped here, not in the form:
    // the schema has already refused any name that is not a name, and this is
    // the last point a crafted request passes through.
    p_package_names: normalisePackageNames(parsedInput.packages),
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

/**
 * The Edit Project dialog (APX-11). Guard → parse (updateProjectSchema: money
 * and percentages as strict strings, so NaN or a negative never reaches
 * Number()) → the checks that need the current row (projectEditRefusal, on
 * the field they concern) → one update scoped to the live row, where zero
 * rows back means it was deleted meanwhile (NOT_FOUND), never a silent
 * "saved". Status is not here: it goes through setProjectStatus and its RPC.
 */
export const updateProject = adminAction
  .inputSchema(updateProjectSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...patch } = parsedInput;
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("projects")
      .select("status, start_date, mobilisation_recovered")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error("NOT_FOUND: project");

    const refusal = projectEditRefusal(
      {
        status: current.status,
        startDate: current.start_date,
        mobilisationRecovered: current.mobilisation_recovered,
      },
      patch
    );
    if (refusal) return { status: "invalid" as const, ...refusal };

    const { data, error } = await supabase
      .from("projects")
      .update({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.location !== undefined && { location: patch.location || null }),
        ...(patch.targetEndDate !== undefined && { target_end_date: patch.targetEndDate || null }),
        ...(patch.contractValue !== undefined && { contract_value: Number(patch.contractValue) }),
        ...(patch.gstRatePct !== undefined && { gst_rate_pct: Number(patch.gstRatePct) }),
        ...(patch.retentionPct !== undefined && { retention_pct: Number(patch.retentionPct) }),
        ...(patch.masBillablePct !== undefined && { mas_billable_pct: Number(patch.masBillablePct) }),
        ...(patch.tdsPct !== undefined && { tds_pct: Number(patch.tdsPct) }),
        ...(patch.mobilisationAdvance !== undefined && {
          mobilisation_advance: Number(patch.mobilisationAdvance),
        }),
        ...(patch.mobilisationRecoveryPct !== undefined && {
          mobilisation_recovery_pct: Number(patch.mobilisationRecoveryPct),
        }),
        updated_by: ctx.session.userId,
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (data.length === 0) throw new Error("NOT_FOUND: project");

    updateTag(`project:${id}`);
    revalidatePath("/");
    // 'layout': every route under this project (dashboard, packages,
    // package detail) can render fields this action changes.
    revalidatePath(`/projects/${id}`, "layout");
    return { status: "saved" as const };
  });

/**
 * The status control (APX-11). rpc_set_project_status decides everything —
 * the legal transitions, that only an admin may move it, that a reopen needs
 * a reason — and writes the audit row in the same transaction; this only
 * passes it on. completed_at is stamped by trg_projects_completed_at.
 */
export const setProjectStatus = adminAction
  .inputSchema(setProjectStatusSchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rpc_set_project_status", {
      p_project_id: parsedInput.id,
      p_status: parsedInput.status,
      ...(parsedInput.reason ? { p_reason: parsedInput.reason } : {}),
    });
    if (error) throw new Error(error.message);

    updateTag(`project:${parsedInput.id}`);
    revalidatePath("/");
    revalidatePath(`/projects/${parsedInput.id}`, "layout");
    return { status: data };
  });

/** What the Edit Project dialog loads on open. Admin only; money as strings
 *  (code-standards §6) so the form shows exactly what is stored. */
export type ProjectForEdit = {
  id: string;
  name: string;
  location: string;
  startDate: string;
  targetEndDate: string;
  contractValue: string;
  gstRatePct: string;
  retentionPct: string;
  masBillablePct: string;
  tdsPct: string;
  mobilisationAdvance: string;
  mobilisationRecovered: string;
  mobilisationRecoveryPct: string;
  status: ProjectStatus;
};

export async function getProjectForEdit(projectId: string): Promise<ProjectForEdit | null> {
  "use server";
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, name, location, start_date, target_end_date, contract_value, gst_rate_pct, retention_pct, mas_billable_pct, tds_pct, mobilisation_advance, mobilisation_recovered, mobilisation_recovery_pct, status"
    )
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    location: data.location ?? "",
    startDate: data.start_date,
    targetEndDate: data.target_end_date ?? "",
    contractValue: String(data.contract_value),
    gstRatePct: String(data.gst_rate_pct),
    retentionPct: String(data.retention_pct),
    masBillablePct: String(data.mas_billable_pct),
    tdsPct: String(data.tds_pct),
    mobilisationAdvance: String(data.mobilisation_advance),
    mobilisationRecovered: String(data.mobilisation_recovered),
    mobilisationRecoveryPct: String(data.mobilisation_recovery_pct),
    status: parseProjectStatus(data.status) ?? "planning",
  };
}

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
 * The New Project dialog's duplicate-name check — a WARNING, never a rejection.
 * Two projects genuinely may share a name (a repeat commission for the same
 * client, a second phase), and `rpc_create_project` already makes the project
 * code unique, so nothing breaks; the person is told and decides. That is why
 * this lives here as a read rather than in `createProject`, and why there is
 * no unique constraint in the database.
 *
 * Names are compared in JS rather than with `ilike`: a project name may
 * legitimately contain `%` or `_`, which are wildcards in a LIKE pattern. One
 * org's project list is small (tens of rows), and RLS scopes it to the
 * caller's org and the soft-delete filter is explicit.
 */
export async function findProjectWithName(name: string): Promise<{ id: string; name: string } | null> {
  "use server";
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data.find((project) => isSameProjectName(project.name, name)) ?? null;
}

/**
 * Grants an existing profile access to a project (CAN.manageProjectMembers):
 * the Client access card (an existing client login, D51), the Site team card
 * (a Site Supervisor, APX-12) and Projects on a Users-page row. Returns
 * `already_member` rather than an error for a repeat grant, and
 * `{ status: "refused", reason }` for an admin (implicit member) or a profile
 * of the other role than the card manages.
 */
export const addProjectMember = adminAction
  .inputSchema(addProjectMemberSchema)
  .action(async ({ parsedInput, ctx }) => {
    const supabase = await createClient();
    const result = await insertProjectMember(supabase, {
      projectId: parsedInput.projectId,
      profileId: parsedInput.profileId,
      addedBy: ctx.session.userId,
      expectedRole: parsedInput.expectedRole,
    });
    if (typeof result === "object") return result;

    updateTag(`project:${parsedInput.projectId}`);
    revalidatePath("/");
    revalidatePath(`/projects/${parsedInput.projectId}`, "layout");
    revalidatePath("/users");
    return { status: result };
  });

/**
 * Takes a client login or a Site Supervisor off one project (Remove on the
 * Client access and Site team cards, and in Projects on a Users-page row).
 * Their other projects and the login itself are untouched. A refusal (an
 * admin, not a member, the other role) comes back as
 * `{ status: "refused", reason }`, not an error.
 */
export const removeProjectMember = adminAction
  .inputSchema(removeProjectMemberSchema)
  .action(async ({ parsedInput }) => {
    const supabase = await createClient();
    const result = await deleteProjectMember(supabase, parsedInput);
    if (result.status === "removed") {
      updateTag(`project:${parsedInput.projectId}`);
      revalidatePath("/");
      revalidatePath(`/projects/${parsedInput.projectId}`, "layout");
      revalidatePath("/users");
    }
    return result;
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
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}
