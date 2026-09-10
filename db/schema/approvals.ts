import { date, index, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { approvalStatus, approvalType } from "./enums";
import { auditColumns, tsz } from "./columns";
import { orgs, profiles } from "./identity";
import { projects } from "./projects";
import { packages, phases } from "./work";

/**
 * Mirrors migration 0008. Only a Client may decide an approval; that rule lives
 * in rpc_decide_approval, and there is deliberately no update policy for anyone
 * to bypass it with.
 */
export const approvals = pgTable(
  "approvals",
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
    type: approvalType("type").notNull(),
    item: text("item").notNull(),
    note: text("note"),
    neededBy: date("needed_by"),
    status: approvalStatus("status").notNull().default("pending"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => profiles.id),
    decidedBy: uuid("decided_by").references(() => profiles.id),
    decidedAt: tsz("decided_at"),
    decisionReason: text("decision_reason"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => approvals.id),
    ...auditColumns,
  },
  (t) => [index("idx_ap_project_status").on(t.projectId, t.status), index("idx_ap_org").on(t.orgId)]
);
