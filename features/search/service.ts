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
