"use server";

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminAction } from "@/lib/safe-action";
import { requireRole } from "@/lib/auth/session";
import { createPackageSchema, createPhaseSchema, updatePackageSchema, updatePhaseSchema } from "./schema";

/**
 * build/04-projects-packages-phases.md §4.2: createPackage, updatePackage,
 * createPhase, updatePhase (markPhaseComplete is deferred to Build 05, where
 * the "phase has no tasks" precondition can actually be tested). No business
 * arithmetic here — guard, parse, delegate, revalidate (AGENTS.md's layering
 * rule).
 *
 * seq_no for a new package/phase is "current max + 1", read then written as
 * two statements rather than a single atomic RPC. This is not the class of
 * mutation AGENTS.md's RPC rule targets (that rule is about stock and money
 * quantities changing under concurrent writers — inventory levels, bill
 * state); two admins adding a package to the same project in the same instant
 * is rare, and `packages_seq_uq` / `phases_seq_uq` (02-lld.md §3.3) turn the
 * rare collision into a rejected insert, never a silently wrong sequence.
 */

async function nextSeqNo(table: "packages" | "phases", column: "project_id" | "package_id", id: string) {
  const supabase = await createClient();
  const query =
    table === "packages"
      ? supabase.from("packages").select("seq_no").eq("project_id", id)
      : supabase.from("phases").select("seq_no").eq("package_id", id);
  const { data, error } = await query.is("deleted_at", null).order("seq_no", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return (data[0]?.seq_no ?? 0) + 1;
}

export const createPackage = adminAction.inputSchema(createPackageSchema).action(async ({ parsedInput, ctx }) => {
  const supabase = await createClient();
  const seqNo = await nextSeqNo("packages", "project_id", parsedInput.projectId);
  const { data, error } = await supabase
    .from("packages")
    .insert({
      org_id: ctx.session.orgId,
      project_id: parsedInput.projectId,
      seq_no: seqNo,
      name: parsedInput.name,
      allocated_amount: Number(parsedInput.allocatedAmount),
      internal_amount: Number(parsedInput.internalAmount),
      lead_profile_id: parsedInput.leadProfileId ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

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
    throw new Error("This package was changed by someone else. Reload to see the current values.");
  }

  updateTag(`project:${data.project_id}`);
  revalidatePath(`/projects/${data.project_id}`, "layout");
  return { ok: true as const };
});

export const createPhase = adminAction.inputSchema(createPhaseSchema).action(async ({ parsedInput, ctx }) => {
  const supabase = await createClient();
  const seqNo = await nextSeqNo("phases", "package_id", parsedInput.packageId);

  const { data: pkg, error: pkgErr } = await supabase
    .from("packages")
    .select("project_id")
    .eq("id", parsedInput.packageId)
    .single();
  if (pkgErr) throw new Error(pkgErr.message);

  const { data, error } = await supabase
    .from("phases")
    .insert({
      org_id: ctx.session.orgId,
      package_id: parsedInput.packageId,
      project_id: pkg.project_id,
      seq_no: seqNo,
      name: parsedInput.name,
      allocated_amount: Number(parsedInput.allocatedAmount),
      internal_amount: Number(parsedInput.internalAmount),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  updateTag(`project:${pkg.project_id}`);
  revalidatePath(`/projects/${pkg.project_id}`, "layout");
  return { id: data.id };
});

export const updatePhase = adminAction.inputSchema(updatePhaseSchema).action(async ({ parsedInput }) => {
  const { id, ...patch } = parsedInput;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phases")
    .update({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.allocatedAmount !== undefined && { allocated_amount: Number(patch.allocatedAmount) }),
      ...(patch.internalAmount !== undefined && { internal_amount: Number(patch.internalAmount) }),
    })
    .eq("id", id)
    .select("id, project_id, package_id")
    .single();
  if (error) throw new Error(error.message);

  updateTag(`project:${data.project_id}`);
  revalidatePath(`/projects/${data.project_id}`, "layout");
  return { ok: true as const };
});

/**
 * Two plain, read-only Server Actions (not next-safe-action clients, matching
 * features/auth/actions.ts's `signOut`) that the dialogs call on open — a
 * form needs a real profile UUID for its Lead field and the row's current
 * `updated_at` for optimistic concurrency, neither of which the prototype's
 * mock AppContext can supply for a package created since this build.
 */

export async function getStaffOptions(): Promise<{ id: string; name: string }[]> {
  "use server";
  await requireRole(["owner", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("role", ["owner", "admin", "site"])
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
  await requireRole(["owner", "admin"]);
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
