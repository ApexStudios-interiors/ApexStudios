/**
 * build/07-stock-inventory-notifications.md §2.3, §3. Pure oracle for
 * `v_inventory_status`/`v_inventory_site`'s own `stock_status` case
 * expression (`supabase/migrations/20260909170013_views_rollups.sql`) — the
 * SQL is the real, authoritative computation; this exists to test that exact
 * boundary logic without a database round trip, and to give the client a
 * consistent label if it ever needs one ahead of a fresh fetch.
 */
export type InventoryStatus = "critical" | "low" | "ok";

export function inventoryStatus(qtyOnHand: number, reorderLevel: number): InventoryStatus {
  if (qtyOnHand === 0) return "critical";
  if (qtyOnHand < reorderLevel) return "low";
  return "ok";
}

/**
 * The Inventory toolbar's `q` search param. Normalising and building the
 * filter live here, not in `queries.ts`, so both are unit-testable without a
 * database round trip — the same reason `inventoryStatus` is here.
 */

/** Long enough for the longest real item name, short enough that a pasted
 *  essay never becomes an unbounded `ilike` scan. */
const SEARCH_MAX_LENGTH = 80;

/** Trims the raw `q` param and returns `undefined` for anything that should
 *  not narrow the list at all, so a caller can test truthiness once rather
 *  than re-deciding what "empty" means. A single character is a legitimate
 *  filter on a table (unlike the global SearchBar's two-character minimum,
 *  which exists to stop seven `ilike` scans firing per keystroke). */
export function normalizeInventorySearch(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? "").trim().slice(0, SEARCH_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Builds the PostgREST `or=(…)` filter that matches the user's LITERAL text
 * against either the item name or its category. Three separate layers of
 * hostile input have to be defused, and in this order:
 *
 *  1. `*` is PostgREST's own wildcard for `like`/`ilike` — it rewrites `*` to
 *     `%` after parsing, with no escape hatch, so the only way to keep it
 *     literal is to drop it.
 *  2. `\`, `%` and `_` are SQL `LIKE` wildcards (same escape as
 *     `features/search/queries.ts`: "M_20 grade" must not match "M120 grade").
 *  3. `,` `.` `(` `)` `"` are PostgREST's own `or=` separators. Double-quoting
 *     the value makes them literal; inside those quotes `"` and `\` take a
 *     backslash — which also re-escapes the backslashes step 2 just added,
 *     exactly as PostgREST's quoted-string parser expects.
 */
export function inventorySearchFilter(term: string): string {
  const likeEscaped = term.replace(/\*/g, "").replace(/[\\%_]/g, (c) => `\\${c}`);
  const quoted = `"${`%${likeEscaped}%`.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  return `name.ilike.${quoted},category.ilike.${quoted}`;
}
