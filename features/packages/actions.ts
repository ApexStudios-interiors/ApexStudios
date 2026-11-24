"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction } from "@/lib/safe-action";
import { requireRole } from "@/lib/auth/session";
import { createPackageSchema, createPhaseSchema, updatePackageSchema, updatePhaseSchema } from "./schema";
import { isPhaseBilled, phaseAllocatedChangeRefusal } from "./service";

/**
 * build/04-projects-packages-phases.md §4.2: createPackage, updatePackage,
 * createPhase, updatePhase (markPhaseComplete is deferred to Build 05, where
 * the "phase has no tasks" precondition can actually be tested). No business
 * arithmetic here — guard, parse, delegate, revalidate (AGENTS.md's layering
 * rule).
 *
 * seq_no for a new package/phase is not chosen here. It used to be "current
 * live max + 1", read then written as two statements: two admins adding at
 * once collided on `packages_seq_uq` / `phases_seq_uq`, and because those
 * uniques cover soft-deleted rows, a deleted package's number was handed out
 * again and ALWAYS collided. A BEFORE INSERT trigger now allocates it under a
 * lock on the parent row, over every row including deleted ones (migration
 * 20261124600003, APX-45/APX-66). The insert simply omits the column.
 */

/** Maps the one Postgres error a create can still raise for a reason the
 *  user can act on — a unique violation, e.g. racing a data repair that set
 *  an explicit seq_no — to the CONFLICT domain code, so the user sees
 *  "someone else changed this" rather than "Something went wrong". */
function createError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error(`CONFLICT: ${error.message}`);
  return new Error(error.message);
}

export const createPackage = adminAction
  .inputSchema(createPackageSchema)
  .action(async ({ parsedInput, ctx }) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("packages")
      .insert({
        org_id: ctx.session.orgId,
        project_id: parsedInput.projectId,
        name: parsedInput.name,
        allocated_amount: Number(parsedInput.allocatedAmount),
        internal_amount: Number(parsedInput.internalAmount),
        lead_profile_id: parsedInput.leadProfileId ?? null,
      })
      .select("id")
      .single();
    if (error) throw createError(error);

    updateTag(`project:${parsedInput.projectId}`);
    // 'layout' revalidates this whole project subtree in one call — the
    // dashboard AND the packages list both render the same packages table.
    // Found live: adding a package from the dashboard closed the dialog but
    // left its (unrevalidated) table stale, because this only ever
    // invalidated the sibling /packages route, never the page the dialog was
    // actually opened from.
    revalidatePath(`/projects/${parsedInput.projectId}`, "layout");
    return { id: data.id };
  });

export const updatePackage = adminAction.inputSchema(updatePackageSchema).action(async ({ parsedInput }) => {
  const { id, updatedAt, ...patch } = parsedInput;
  const supabase = await createClient();

  // Optimistic concurrency (architecture.md §8.3): the update is scoped to
  // BOTH id and the updated_at the form was loaded with. A zero-row result
  // means someone else saved first — that is reported as a conflict, never
  // silently overwritten or silently discarded.
  const { data, error } = await supabase
    .from("packages")
    .update({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.allocatedAmount !== undefined && { allocated_amount: Number(patch.allocatedAmount) }),
      ...(patch.internalAmount !== undefined && { internal_amount: Number(patch.internalAmount) }),
      ...(patch.leadProfileId !== undefined && { lead_profile_id: patch.leadProfileId }),
      ...(patch.status !== undefined && { status: patch.status }),
    })
    .eq("id", id)
    .eq("updated_at", updatedAt)
    .select("id, project_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    // CONFLICT is a mapped domain code (lib/safe-action.ts): unprefixed, this
    // reached the user as "Something went wrong" (APX-45). Progress-only
    // writes no longer move updated_at (migration 20261124600003), so this
    // now means a real concurrent edit of something the form shows.
    throw new Error("CONFLICT: package was changed by someone else");
  }

  updateTag(`project:${data.project_id}`);
  revalidatePath(`/projects/${data.project_id}`, "layout");
  return { ok: true as const };
});

/**
 * Add Phase (APX-10) — from the package's Budget tab, and from Add Task when
 * the package has no phase yet. A read-only (archived) project is refused by
 * trg_project_writable with PROJECT_ARCHIVED. seq_no is allocated by the
 * database (trg_phases_assign_seq, APX-45), so concurrent adds do not collide.
 */
export const createPhase = adminAction.inputSchema(createPhaseSchema).action(async ({ parsedInput, ctx }) => {
  const supabase = await createClient();

  const { data: pkg, error: pkgErr } = await supabase
    .from("packages")
    .select("project_id")
    .eq("id", parsedInput.packageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (pkgErr) throw new Error(pkgErr.message);
  if (!pkg) throw new Error("NOT_FOUND: package");

  const { data, error } = await supabase
    .from("phases")
    .insert({
      org_id: ctx.session.orgId,
      package_id: parsedInput.packageId,
      project_id: pkg.project_id,
      name: parsedInput.name,
      allocated_amount: Number(parsedInput.allocatedAmount),
      internal_amount: Number(parsedInput.internalAmount),
    })
    .select("id")
    .single();
  if (error) throw createError(error);

  updateTag(`project:${pkg.project_id}`);
  revalidatePath(`/projects/${pkg.project_id}`, "layout");
  return { id: data.id };
});

/**
 * Edit Phase (APX-10). Optimistic concurrency as updatePackage: the update
 * is scoped to `id` AND the `updated_at` the form loaded, and zero rows back
 * is CONFLICT. A phase already on a bill keeps its allocated amount
 * (phaseAllocatedChangeRefusal, checked here for an inline message;
 * trg_phases_allocated_locked is the boundary).
 */
export const updatePhase = adminAction.inputSchema(updatePhaseSchema).action(async ({ parsedInput }) => {
  const { id, updatedAt, ...patch } = parsedInput;
  const supabase = await createClient();

  const { data: current, error: readErr } = await supabase
    .from("phases")
    .select("billing_status, allocated_amount")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!current) throw new Error("NOT_FOUND: phase");

  const billed = phaseAllocatedChangeRefusal(
    { billingStatus: current.billing_status, allocatedAmount: current.allocated_amount },
    patch.allocatedAmount
  );
  if (billed) return { status: "invalid" as const, field: "allocatedAmount" as const, message: billed };

  const { data, error } = await supabase
    .from("phases")
    .update({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.allocatedAmount !== undefined && { allocated_amount: Number(patch.allocatedAmount) }),
      ...(patch.internalAmount !== undefined && { internal_amount: Number(patch.internalAmount) }),
    })
    .eq("id", id)
    .eq("updated_at", updatedAt)
    .is("deleted_at", null)
    .select("id, project_id, package_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("CONFLICT: phase changed since the form loaded");

  updateTag(`project:${data.project_id}`);
  revalidatePath(`/projects/${data.project_id}`, "layout");
  return { status: "saved" as const };
});

export type PhaseForEdit = {
  id: string;
  name: string;
  allocatedAmount: string;
  internalAmount: string;
  /** Billed or Paid: the dialog locks Allocated and says why. */
  billed: boolean;
  updatedAt: string;
};

/** What Edit Phase loads on open — the row's values and its `updated_at`. */
export async function getPhaseForEdit(phaseId: string): Promise<PhaseForEdit | null> {
  "use server";
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phases")
    .select("id, name, allocated_amount, internal_amount, billing_status, updated_at")
    .eq("id", phaseId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    allocatedAmount: String(data.allocated_amount),
    internalAmount: String(data.internal_amount),
    billed: isPhaseBilled(data.billing_status),
    updatedAt: data.updated_at,
  };
}

/**
 * Two plain, read-only Server Actions (not next-safe-action clients, matching
 * features/auth/actions.ts's `signOut`) that the dialogs call on open — a
 * form needs a real profile UUID for its Lead field and the row's current
 * `updated_at` for optimistic concurrency, neither of which the prototype's
 * mock AppContext can supply for a package created since this build.
 */

export async function getStaffOptions(): Promise<{ id: string; name: string }[]> {
  "use server";
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("role", ["admin", "site"])
    .is("deleted_at", null)
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  return data.map((p) => ({ id: p.id, name: p.full_name }));
}

export type PackageForEdit = {
  id: string;
  name: string;
  allocatedAmount: string;
  internalAmount: string;
  leadProfileId: string | null;
  status: "not_started" | "design" | "in_progress" | "completed";
  updatedAt: string;
};

export async function getPackageForEdit(packageId: string): Promise<PackageForEdit | null> {
  "use server";
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("packages")
    .select("id, name, allocated_amount, internal_amount, lead_profile_id, status, updated_at")
    .eq("id", packageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    allocatedAmount: String(data.allocated_amount),
    internalAmount: String(data.internal_amount),
    leadProfileId: data.lead_profile_id,
    status: data.status,
    updatedAt: data.updated_at,
  };
}
