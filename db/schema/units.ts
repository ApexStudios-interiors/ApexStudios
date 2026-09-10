import { integer, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Mirrors migration 0006. The closed unit vocabulary, confirmed 2026-09-10:
 * bag, sft, kit, len, can, sqm, rft, nos, set.
 *
 * Both inventory_items.unit and stock_requests.unit reference this. Build 07's
 * dropdown reads it rather than duplicating the list here. Adding a unit is a
 * migration, not a dashboard edit.
 */
export const units = pgTable("units", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
