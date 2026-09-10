import { date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { stockRequestStatus } from "./enums";
import { auditColumns, money, quantity, tsz } from "./columns";
import { orgs, profiles } from "./identity";
import { projects } from "./projects";
import { packages, phases } from "./work";
import { inventoryItems } from "./inventory";
import { units } from "./units";

/** Mirrors migration 0007. `rate` is internal cost, so this table is admin-only. */
export const stockRequests = pgTable(
  "stock_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    phaseId: uuid("phase_id").references(() => phases.id),
    refNo: text("ref_no").notNull(),
    /** null means a material not yet in inventory. */
    inventoryItemId: uuid("inventory_item_id").references(() => inventoryItems.id),
    materialName: text("material_name").notNull(),
    qty: quantity("qty").notNull(),
    unit: text("unit")
      .notNull()
      .references(() => units.code),
    /** ADMIN ONLY — internal cost per unit. */
    rate: money("rate"),
    neededBy: date("needed_by"),
    note: text("note"),
    status: stockRequestStatus("status").notNull().default("pending"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => profiles.id),
    approvedBy: uuid("approved_by").references(() => profiles.id),
    approvedAt: tsz("approved_at"),
    orderedAt: tsz("ordered_at"),
    deliveredBy: uuid("delivered_by").references(() => profiles.id),
    deliveredAt: tsz("delivered_at"),
    rejectedReason: text("rejected_reason"),
    /** Half of the double-billing guard. The FK is added in migration 0010. */
    billedOnBillId: uuid("billed_on_bill_id"),
    ...auditColumns,
  },
  (t) => [
    index("idx_sr_project_status").on(t.projectId, t.status),
    index("idx_sr_package").on(t.packageId),
    index("idx_sr_org").on(t.orgId),
  ]
);

export const stockRequestEvents = pgTable(
  "stock_request_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => stockRequests.id, { onDelete: "cascade" }),
    fromStatus: stockRequestStatus("from_status"),
    toStatus: stockRequestStatus("to_status").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => profiles.id),
    note: text("note"),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_sr_events_request").on(t.requestId, t.createdAt)]
);
