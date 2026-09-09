import { date, index, integer, pgTable, smallint, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { packageStatus, phaseBillingStatus } from "./enums";
import { auditColumns, money, tsz } from "./columns";
import { orgs, profiles } from "./identity";
import { projects } from "./projects";

/**
 * Mirrors migration 0005.
 *
 * packages and phases carry internal_amount, the column the whole product is
 * built to protect. Their RLS select policy is is_admin() only; non-admins read
 * v_package_client / v_package_site / v_phase_client instead.
 */
export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    seqNo: integer("seq_no").notNull(),
    name: text("name").notNull(),
    leadProfileId: uuid("lead_profile_id").references(() => profiles.id),
    allocatedAmount: money("allocated_amount").notNull().default("0"),
    /** ADMIN ONLY. */
    internalAmount: money("internal_amount").notNull().default("0"),
    status: packageStatus("status").notNull().default("not_started"),
    /** Cached, maintained by trg_tasks_after_update. */
    progressPct: smallint("progress_pct").notNull().default(0),
    ...auditColumns,
  },
  (t) => [index("idx_packages_project").on(t.projectId), index("idx_packages_org").on(t.orgId)]
);

export const phases = pgTable(
  "phases",
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
      .references(() => packages.id, { onDelete: "cascade" }),
    seqNo: integer("seq_no").notNull(),
    name: text("name").notNull(),
    allocatedAmount: money("allocated_amount").notNull().default("0"),
    /** ADMIN ONLY. */
    internalAmount: money("internal_amount").notNull().default("0"),
    billingStatus: phaseBillingStatus("billing_status").notNull().default("unresolved"),
    manualCompleteAt: tsz("manual_complete_at"),
    manualCompleteBy: uuid("manual_complete_by").references(() => profiles.id),
    ...auditColumns,
  },
  (t) => [
    index("idx_phases_package").on(t.packageId),
    index("idx_phases_project_billing").on(t.projectId, t.billingStatus),
    index("idx_phases_org").on(t.orgId),
  ]
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    /** Denormalised so RLS reads an indexed local column, not a two-join lateral. */
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    phaseId: uuid("phase_id")
      .notNull()
      .references(() => phases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ownerProfileId: uuid("owner_profile_id").references(() => profiles.id),
    /** Real dates. The 14-week Gantt grid is a viewport over them (ADR-011). */
    startDate: date("start_date").notNull(),
    durationWeeks: integer("duration_weeks").notNull().default(1),
    endDate: date("end_date").generatedAlwaysAs(sql`(start_date + (duration_weeks * 7) - 1)`),
    progressPct: smallint("progress_pct").notNull().default(0),
    note: text("note"),
    ...auditColumns,
  },
  (t) => [
    index("idx_tasks_phase").on(t.phaseId),
    index("idx_tasks_package").on(t.packageId),
    index("idx_tasks_project_dates").on(t.projectId, t.startDate, t.endDate),
    index("idx_tasks_org").on(t.orgId),
  ]
);
