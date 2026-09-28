/**
 * Readable URL segments, kept pure so they can be tested without a database
 * or a request.
 *
 * `/projects/00000000-0000-4000-8000-0000000000c1/packages/0000…e2/budget`
 * becomes `/projects/bhel-nch/packages/facade-and-windows/budget`.
 *
 * Both halves already have a unique key in the schema, so none of this needs
 * a migration: `projects_code_uq (org_id, code)` and
 * `packages_seq_uq (project_id, seq_no)`.
 *
 * A package NAME is not unique — this database has two packages called
 * "Test" — so a name slug alone cannot address one. `packageSlug` therefore
 * appends the sequence number when asked to disambiguate, and the resolver
 * accepts both shapes.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID. Used to tell an old link from a readable one. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Lowercase, ASCII, hyphen-separated.
 *
 * Accents are folded rather than dropped (NFD + strip combining marks), so
 * "Façade" becomes "facade" and not "faade". Anything else that is not a
 * letter, digit or hyphen becomes a hyphen, runs collapse, and the ends are
 * trimmed — "MEP & HVAC" → "mep-hvac", "Block-A / Tower 2" → "block-a-tower-2".
 *
 * Returns "" when nothing survives (a name of only punctuation, say). Callers
 * must treat "" as "no readable form" and fall back, rather than emitting a
 * path with an empty segment.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A project's URL segment: its code, lowercased. `BHEL-NCH` → `bhel-nch`. */
export function projectSlug(code: string): string {
  return slugify(code);
}

/**
 * A package's URL segment.
 *
 * `disambiguate` is set by the caller when another live package in the same
 * project slugifies identically; the sequence number is then appended, which
 * `packages_seq_uq` guarantees is unique. It also covers the empty-slug case,
 * so a package named "***" addresses as "7" rather than "".
 */
export function packageSlug(name: string, seqNo: number, disambiguate = false): string {
  const base = slugify(name);
  if (!base) return String(seqNo);
  return disambiguate ? `${base}-${seqNo}` : base;
}

/**
 * Splits a package segment into the name part and a trailing sequence number,
 * for the resolver. `facade-and-windows` → no number; `test-8` → 8;
 * `7` → 7 with an empty name.
 *
 * A trailing number is only ever TREATED as a sequence when the name part
 * alone is ambiguous — "tower-2" is a real package name and must not be read
 * as "tower" number 2. That decision belongs to the resolver, which can see
 * the candidates; this function only reports what is there.
 */
export function splitPackageSegment(segment: string): { name: string; seqNo: number | null } {
  const m = /^(.*?)-?(\d+)$/.exec(segment);
  if (!m) return { name: segment, seqNo: null };
  const [, name, digits] = m;
  return { name: name ?? "", seqNo: Number(digits) };
}
