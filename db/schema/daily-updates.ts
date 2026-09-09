import { date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns";
import { orgs, profiles } from "./identity";
import { projects } from "./projects";
import { packages } from "./work";

/**
 * Mirrors migration 0009. Editable by their author for 24 hours, then frozen:
 * a supervisor should be able to fix a typo, and nobody should be able to
 * rewrite history three months later during a dispute.
 */
export const dailyUpdates = pgTable(
  "daily_updates",
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
    updateDate: date("update_date").notNull(),
    body: text("body").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => profiles.id),
    ...auditColumns,
  },
  (t) => [
    index("idx_du_project_date").on(t.projectId, t.updateDate),
    index("idx_du_package_date").on(t.packageId, t.updateDate),
    index("idx_du_author").on(t.authorId),
    index("idx_du_org").on(t.orgId),
  ]
);
