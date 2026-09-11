import { date, index, integer, pgTable, primaryKey, smallint, text, uuid } from "drizzle-orm/pg-core";
import { projectStatus } from "./enums";
import { auditColumns, money, percentage, tsz } from "./columns";
import { clients, orgs, profiles } from "./identity";

/** Mirrors migration 0004. */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    /** Appears in every bill number forever; unique per org (D6). */
    code: text("code").notNull(),
    name: text("name").notNull(),
    location: text("location"),
    status: projectStatus("status").notNull().default("planning"),
    startDate: date("start_date").notNull(),
    targetEndDate: date("target_end_date"),
    contractValue: money("contract_value").notNull().default("0"),

    // Billing constants are per project (ADR-004). Never hard-code 18 / 5 / 75.
    gstRatePct: percentage("gst_rate_pct").notNull().default("18"),
    retentionPct: percentage("retention_pct").notNull().default("5"),
    masBillablePct: percentage("mas_billable_pct").notNull().default("75"),
    tdsPct: percentage("tds_pct").notNull().default("0"),

    // D7: mobilisation advances are tracked, with recoveries and a balance.
    mobilisationAdvance: money("mobilisation_advance").notNull().default("0"),
    mobilisationRecovered: money("mobilisation_recovered").notNull().default("0"),

    progressPct: smallint("progress_pct").notNull().default(0),
    /** Incremented under a row lock in rpc_create_bill; count(*)+1 would race. */
    nextBillSeq: integer("next_bill_seq").notNull().default(1),
    /** Same pattern (D18), for rpc_create_stock_request's SR-{code}-{n} ref_no. */
    nextSrSeq: integer("next_sr_seq").notNull().default(1),
    ...auditColumns,
  },
  (t) => [index("idx_projects_org_status").on(t.orgId, t.status), index("idx_projects_client").on(t.clientId)]
);

/**
 * owner and admin are implicit members of every project in their org and have no
 * rows here (02-lld.md §3.2).
 */
export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    addedAt: tsz("added_at").notNull().defaultNow(),
    addedBy: uuid("added_by"),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.profileId] }),
    index("idx_project_members_profile").on(t.profileId),
  ]
);
