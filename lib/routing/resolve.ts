import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid, packageSlug, projectSlug, slugify, splitPackageSegment } from "./slug";

/**
 * Maps between the readable URL segments and the ids the routes actually use.
 *
 * Used from middleware, which already holds a Supabase client bound to the
 * caller's session — so every lookup here is RLS-scoped and cannot be used to
 * probe for a project code in another organisation. It resolves, it does not
 * authorise: the page still runs `requireProjectAccess` (AGENTS.md keeps
 * authorisation out of middleware, and this does not change that).
 *
 * The routes on disk stay `[projectId]`/`[moduleId]` and keep receiving UUIDs.
 * A readable path is REWRITTEN to the id path rather than becoming the real
 * route, which matters for a reason that is easy to miss: every mutation calls
 * `revalidatePath('/projects/<uuid>', 'layout')`, and no route opts into
 * `cacheTag` yet, so those `updateTag` calls are currently inert. Making the
 * slug the real route would leave every one of those invalidating a path that
 * no longer renders — stale data after every bill, task and stock change.
 */

/**
 * The middleware's own client type. Deliberately the default generic
 * parameters rather than the generated `Database`: middleware builds its
 * client with `createServerClient` from `@supabase/ssr` without the schema
 * generic, and pinning a narrower type here makes this module unusable from
 * the one place that calls it.
 */
type Client = SupabaseClient;

/** `bhel-nch` → the project's UUID, or null if no live project matches. */
export async function projectIdFromSlug(supabase: Client, slug: string): Promise<string | null> {
  if (isUuid(slug)) return slug;
  const wanted = slugify(slug);
  // Ask the database for the ONE row, rather than pulling every project the
  // caller can see and filtering in JavaScript — this runs in middleware, on
  // every request to a project URL. `ilike` because the segment is the code
  // lowercased; it matches no wildcard, as a code contains none.
  const { data, error } = await supabase
    .from("projects")
    .select("id, code")
    .ilike("code", wanted)
    .is("deleted_at", null)
    .limit(1);
  if (error || !data) return null;
  const rows = data as { id: string; code: string }[];
  // Re-check through projectSlug rather than trusting ilike: a code could in
  // principle differ from its slug by more than case (slugify also folds
  // punctuation), and resolving the wrong project would be worse than a miss.
  const hit = rows.find((p) => projectSlug(p.code) === wanted);
  return hit?.id ?? null;
}

/** The project's UUID → `bhel-nch`, for redirecting an old link. */
export async function projectSlugFromId(supabase: Client, id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("code")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return projectSlug((data as { code: string }).code);
}

type Pkg = { id: string; name: string; seq_no: number };

async function livePackages(supabase: Client, projectId: string): Promise<Pkg[]> {
  const { data, error } = await supabase
    .from("packages")
    .select("id, name, seq_no")
    .eq("project_id", projectId)
    .is("deleted_at", null);
  if (error || !data) return [];
  return data as Pkg[];
}

/**
 * `facade-and-windows` → the package's UUID within that project.
 *
 * Accepts three shapes, in this order of preference:
 *   1. the name slug, when exactly one package matches it;
 *   2. `<name>-<seq>`, which is what `packageSlug` emits for a duplicated
 *      name — tried only when the plain name matched none or several, so a
 *      genuine name like "Block-A / Tower 2" is never mis-read as "tower"
 *      number 2;
 *   3. a bare sequence number.
 */
export async function packageIdFromSlug(
  supabase: Client,
  projectId: string,
  slug: string
): Promise<string | null> {
  if (isUuid(slug)) return slug;
  const pkgs = await livePackages(supabase, projectId);
  if (pkgs.length === 0) return null;

  const wanted = slugify(slug);
  const byName = pkgs.filter((p) => slugify(p.name) === wanted);
  const onlyMatch = byName.length === 1 ? byName[0] : undefined;
  if (onlyMatch) return onlyMatch.id;

  const { name, seqNo } = splitPackageSegment(slug);
  if (seqNo !== null) {
    const bySeq = pkgs.find((p) => p.seq_no === seqNo);
    // With a name part, require it to agree — `test-8` must not open
    // package 8 when package 8 is called something else entirely.
    if (bySeq && (name === "" || slugify(bySeq.name) === slugify(name))) return bySeq.id;
  }
  return null;
}

/** The package's UUID → its readable segment, disambiguated if it needs to be. */
export async function packageSlugFromId(
  supabase: Client,
  projectId: string,
  packageId: string
): Promise<string | null> {
  const pkgs = await livePackages(supabase, projectId);
  const self = pkgs.find((p) => p.id === packageId);
  if (!self) return null;
  const base = slugify(self.name);
  const clashes = pkgs.filter((p) => slugify(p.name) === base).length > 1;
  return packageSlug(self.name, self.seq_no, clashes);
}
