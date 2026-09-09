import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { movementDirection } from "./enums";
import { auditColumns, money, quantity, tsz } from "./columns";
import { orgs, profiles } from "./identity";
import { projects } from "./projects";

/** Mirrors migration 0006. */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    /** NULL means the central store rather than a project. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category"),
    sku: text("sku"),
    unit: text("unit").notNull(),
    /** A cache of stock_movements, reconciled nightly. Moves only via RPC. */
    qtyOnHand: quantity("qty_on_hand").notNull().default("0"),
    reorderLevel: quantity("reorder_level").notNull().default("0"),
    /** ADMIN/SITE only, never client. */
    unitCost: money("unit_cost").notNull().default("0"),
    location: text("location"),
    ...auditColumns,
  },
  (t) => [
    index("idx_inventory_project").on(t.projectId),
    index("idx_inventory_org_name").on(t.orgId, t.name),
    index("idx_inventory_org").on(t.orgId),
  ]
);

/**
 * Append-only for every role including owner (ADR-007). A mistake is corrected
 * with a compensating 'adjust' row carrying a reason, never an edit.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id),
    projectId: uuid("project_id").references(() => projects.id),
    direction: movementDirection("direction").notNull(),
    /** Always positive; `direction` carries the sign. */
    qty: quantity("qty").notNull(),
    unitCost: money("unit_cost").notNull().default("0"),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    reason: text("reason"),
    createdAt: tsz("created_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => profiles.id),
  },
  (t) => [
    index("idx_movements_item").on(t.inventoryItemId, t.createdAt),
    index("idx_movements_ref").on(t.refType, t.refId),
    index("idx_movements_org").on(t.orgId),
    index("idx_movements_project").on(t.projectId),
  ]
);
