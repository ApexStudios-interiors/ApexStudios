import { packageSlug, projectSlug } from "./slug";

/**
 * The canonical URL for a project or one of its packages.
 *
 * Every internal link goes through here. The point is not tidiness: a link
 * built from a UUID still RESOLVES, because middleware redirects it — but a
 * redirect is a second full request, including its own `getUser()` round trip
 * to Supabase Auth, before the page starts. Building the canonical form in the
 * first place is what removes that, and it is why these take a code and a name
 * rather than an id.
 *
 * Ids remain the identity everywhere else — foreign keys, RPC arguments, cache
 * tags, `revalidatePath`. This is only about what goes in an href.
 */

export type ProjectRef = { code: string };
export type PackageRef = { name: string; seqNo: number; ambiguous?: boolean };

/** `/projects/bhel-nch` plus whatever follows. */
export function projectPath(project: ProjectRef, rest = ""): string {
  const slug = projectSlug(project.code);
  // An empty slug would build `/projects/` + rest, which is a different route
  // entirely — the portfolio page, or a 404 — not a degraded version of this
  // one. Callers that may not have a code check for it and fall back to the
  // id form; this is the backstop for the ones that forget.
  if (!slug) throw new Error("projectPath: project has no usable code");
  return `/projects/${slug}${rest}`;
}

/**
 * `/projects/bhel-nch/packages/facade-and-windows` plus whatever follows.
 *
 * `ambiguous` is set by the caller when another live package in the same
 * project slugifies identically — this database has two called "Test" — and
 * appends the sequence number, which `packages_seq_uq` guarantees is unique.
 * The resolver accepts both shapes.
 */
export function packagePath(project: ProjectRef, pkg: PackageRef, rest = ""): string {
  const slug = packageSlug(pkg.name, pkg.seqNo, pkg.ambiguous ?? false);
  return `${projectPath(project)}/packages/${slug}${rest}`;
}

/**
 * Marks which packages in one project need their sequence number appended.
 * Done once over the list rather than per link, so two packages with the same
 * name cannot be given the same href by two different call sites.
 */
export function withAmbiguityFlags<T extends { name: string; seqNo: number }>(
  packages: readonly T[]
): (T & { ambiguous: boolean })[] {
  const counts = new Map<string, number>();
  for (const p of packages) {
    const base = packageSlug(p.name, p.seqNo, false);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return packages.map((p) => ({
    ...p,
    ambiguous: (counts.get(packageSlug(p.name, p.seqNo, false)) ?? 0) > 1,
  }));
}
