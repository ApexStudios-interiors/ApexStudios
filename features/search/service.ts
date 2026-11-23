/**
 * build/07-stock-inventory-notifications.md §2.7. Pure, no `next/*` or
 * `server-only` imports (HLD §4.3) — the per-category/overall caps are a
 * small piece of real logic worth testing without a DB round trip, same
 * reasoning as `availableTransitions`/`inventoryStatus` in the sibling
 * features.
 */

export const SEARCH_CATEGORIES = [
  "Projects",
  "Packages",
  "Stock Requests",
  "Approvals",
  "Bills",
  "Inventory",
  "Users",
] as const;

export type SearchCategory = (typeof SEARCH_CATEGORIES)[number];

export type SearchResultDTO = {
  id: string;
  category: SearchCategory;
  text: string;
  sub: string;
  href: string;
  /** The project the result belongs to — null for a user or a central-store
   *  item. The web navigates by `href`; the mobile app by this and `id`. */
  projectId: string | null;
};

const PER_CATEGORY_CAP = 5;
const OVERALL_CAP = 25;

/**
 * Caps each category at 5 and the combined total at 25, in the fixed
 * category order above — so which results survive a busy search is
 * deterministic, not whichever queries happened to resolve first.
 */
export function capResults(
  byCategory: Partial<Record<SearchCategory, SearchResultDTO[]>>
): SearchResultDTO[] {
  const capped = SEARCH_CATEGORIES.flatMap((category) =>
    (byCategory[category] ?? []).slice(0, PER_CATEGORY_CAP)
  );
  return capped.slice(0, OVERALL_CAP);
}

/**
 * A PostgREST `or=(…)` filter matching the user's LITERAL text, as a
 * substring, against any of `columns` (APX-64: a stock request by material OR
 * by its ref number, an approval by item OR by ref number — staff quote
 * "SR-BHEL-NCH-014" on the phone).
 *
 * The same three layers of escaping as inventory's `inventorySearchFilter`,
 * in the same order: drop PostgREST's own `*` wildcard; escape LIKE's `\ % _`
 * so "M_20" matches only "M_20"; then double-quote the value so `, . ( ) "`
 * are literal inside `or=`, backslash-escaping `"` and `\` within the quotes.
 */
export function ilikeAnyFilter(columns: readonly string[], term: string): string {
  const likeEscaped = term.replace(/\*/g, "").replace(/[\\%_]/g, (c) => `\\${c}`);
  const quoted = `"${`%${likeEscaped}%`.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  return columns.map((c) => `${c}.ilike.${quoted}`).join(",");
}
