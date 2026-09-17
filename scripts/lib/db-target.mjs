/**
 * The production-database guard, in one place.
 *
 * There is exactly one Supabase project and it is production (docs/decisions.md
 * D49). Everything that migrates, seeds, resets or tests therefore points at
 * the same database unless someone deliberately aims it elsewhere, so the
 * question "is this target production?" has to be asked identically by every
 * one of those entry points.
 *
 * This is the guard `scripts/db-reset.mjs`, `scripts/db-seed.mjs` and
 * `scripts/run-pgtap.mjs` already carried — the same
 * `SUPABASE_PROD_PROJECT_REF` comparison — lifted out of them so all four
 * agree, plus two corrections found while lifting it:
 *
 *   1. A substring match on the ref is not the same as reading the ref out of
 *      the URL. Both are checked here.
 *   2. An unset SUPABASE_PROD_PROJECT_REF used to mean "no guard" — the check
 *      silently passed. Now the target cannot be proven non-production, which
 *      is a refusal on CI or any non-interactive run, and a loud warning
 *      interactively (a developer who has not filled in .env.local yet is not
 *      the failure mode this exists for).
 *
 * No secret is ever printed here: refs, not URLs, and only the production ref,
 * which is already public in NEXT_PUBLIC_SUPABASE_URL.
 */

const PLACEHOLDER = /placeholder/i;

/**
 * The configured production project ref, or null when it is absent or still a
 * placeholder.
 *
 * @returns {string | null}
 */
export function productionRef() {
  const ref = process.env.SUPABASE_PROD_PROJECT_REF?.trim();
  if (!ref || PLACEHOLDER.test(ref)) return null;
  return ref;
}

/**
 * Reads the Supabase project ref out of a database URL or an API URL.
 *
 *   postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres   direct
 *   postgresql://postgres.<ref>:…@…pooler.supabase.com:6543/…    pooled
 *   https://<ref>.supabase.co                                    REST / auth
 *
 * Returns null for anything that is not a Supabase host — a plain Postgres URL
 * has no project ref to read.
 *
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function projectRefFromUrl(url) {
  if (!url) return null;

  const pooled = /:\/\/postgres\.([a-z0-9]{16,64})[:@]/.exec(url);
  if (pooled?.[1]) return pooled[1];

  // The host is what follows the last "@" (credentials may contain "/" or ":"),
  // or what follows the scheme when there are no credentials.
  const authority = url.includes("@")
    ? url.slice(url.lastIndexOf("@") + 1)
    : url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const host = /^([^/?#\s:]+)/.exec(authority)?.[1] ?? "";
  const direct = /^(?:db\.)?([a-z0-9]{16,64})\.supabase\./.exec(host);
  return direct?.[1] ?? null;
}

/**
 * Decides whether a set of targets may be written to.
 *
 * Each target is a database URL, an API URL or a bare project ref; nullish
 * entries are ignored, so a caller can pass an optional URL without guarding
 * the call itself.
 *
 * @param {(string | null | undefined)[]} targets
 * @param {string} what  what is about to run, for the message ("the seed")
 * @returns {{ refuse: string | null, warn: string | null }}
 */
export function checkProductionTarget(targets, what) {
  const prod = productionRef();

  if (!prod) {
    const message =
      `SUPABASE_PROD_PROJECT_REF is not set, so ${what} cannot prove its target is not the\n` +
      "  production project. There is exactly one Supabase project and it IS production\n" +
      "  (docs/decisions.md D49) — an unguarded run is the failure this check exists for.\n" +
      "  Set SUPABASE_PROD_PROJECT_REF in .env.local and in the CI environment.";
    // Non-interactive means nobody is watching a warning scroll past.
    const interactive = !process.env.CI && process.stdout.isTTY;
    return interactive
      ? { refuse: null, warn: `⚠ ${message}\n  Continuing, because this is an interactive run.` }
      : { refuse: `✗ ${message}`, warn: null };
  }

  for (const target of targets) {
    if (!target) continue;
    const trimmed = String(target).trim();
    if (projectRefFromUrl(trimmed) === prod || trimmed === prod || trimmed.includes(prod)) {
      return {
        refuse:
          `✗ Refusing to run ${what} against ${prod}: that is the production project.\n` +
          "  It is the only Supabase project there is, it holds the live data, and this\n" +
          "  command writes. Production schema changes arrive through a merged migration\n" +
          "  (docs/architecture.md §5.2, §7.3); there is no path where seeding, resetting\n" +
          "  or testing against it is the right thing to do.",
        warn: null,
      };
    }
  }

  return { refuse: null, warn: null };
}

/**
 * `checkProductionTarget` for a script: prints, and exits 1 on a refusal.
 *
 * @param {(string | null | undefined)[]} targets
 * @param {string} what
 * @returns {void}
 */
export function assertNotProduction(targets, what) {
  const { refuse, warn } = checkProductionTarget(targets, what);
  if (warn) console.warn(`${warn}\n`);
  if (refuse) {
    console.error(refuse);
    process.exit(1);
  }
}
