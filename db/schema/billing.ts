import { date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { billLineSource, billStatus } from "./enums";
import { money, percentage, tsz } from "./columns";
import { orgs, profiles } from "./identity";
import { projects } from "./projects";

/**
 * Mirrors migration 0010.
 *
 * The order of operations is fixed (HLD §8.4, ADR-005): GST is charged on the
 * taxable value BEFORE retention is deducted, because under Indian GST retention
 * money is part of the value of the supply even though it has not been received.
 * Every figure is stored, never recomputed on read.
 */
export const bills = pgTable(
  "bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    seqNo: integer("seq_no").notNull(),
    /** RA-{project_code}-{n} (D6). */
    billNo: text("bill_no").notNull(),
    billDate: date("bill_date").notNull(),
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    status: billStatus("status").notNull().default("draft"),
    revision: integer("revision").notNull().default(1),

    workValue: money("work_value").notNull().default("0"), // A
    materialValue: money("material_value").notNull().default("0"), // B
    grossAmount: money("gross_amount").notNull().default("0"), // C = A + B
    masRecoveryAmount: money("mas_recovery_amount").notNull().default("0"), // D
    taxableAmount: money("taxable_amount").notNull().default("0"), // E = C - D
    gstAmount: money("gst_amount").notNull().default("0"), // F = E * rate
    invoiceTotal: money("invoice_total").notNull().default("0"), // G = E + F
    retentionAmount: money("retention_amount").notNull().default("0"), // H
    tdsAmount: money("tds_amount").notNull().default("0"), // I
    advanceRecovery: money("advance_recovery").notNull().default("0"), // J
    netPayable: money("net_payable").notNull().default("0"), // K = G - H - I - J

    /** Snapshotted at creation so a later project change cannot restate a bill. */
    gstRatePct: percentage("gst_rate_pct").notNull(),
    retentionPct: percentage("retention_pct").notNull(),
    tdsPct: percentage("tds_pct").notNull(),

    /** ADMIN ONLY. */
    internalCostAmount: money("internal_cost_amount").notNull().default("0"),
    marginAmount: money("margin_amount").notNull().default("0"),

    notes: text("notes"),
    /** Client-generated, from the Create Bill button — "a double-clicked
     *  Create Bill button must not produce two RA bills" (build 09 §4.1). */
    idempotencyKey: text("idempotency_key"),
    // NOT NULL here, unlike the shared auditColumns: a bill without an author
    // is not a document anyone can defend in a dispute.
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id),
    submittedAt: tsz("submitted_at"),
    submittedBy: uuid("submitted_by").references(() => profiles.id),
    certifiedAt: tsz("certified_at"),
    certifiedBy: uuid("certified_by").references(() => profiles.id),
    certificationNote: text("certification_note"),
    paidAt: tsz("paid_at"),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
    deletedAt: tsz("deleted_at"),
  },
  (t) => [
    index("idx_bills_project_status").on(t.projectId, t.status),
    index("idx_bills_org").on(t.orgId),
    // Partial, not `unique nulls not distinct`: this table already has many
    // pre-existing rows with no key at all, and a plain `unique nulls not
    // distinct` collapses every one of those NULLs together per project_id.
    uniqueIndex("bills_idem_uq")
      .on(t.projectId, t.idempotencyKey)
      .where(sql`idempotency_key is not null`),
  ]
);

export const billLines = pgTable(
  "bill_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    sourceType: billLineSource("source_type").notNull(),
    /** phase_id or stock_request_id. */
    sourceId: uuid("source_id"),
    description: text("description").notNull(),
    clientValue: money("client_value").notNull(),
    pctBilled: percentage("pct_billed").notNull().default("100"),
    amount: money("amount").notNull(),
    /** ADMIN ONLY. */
    internalCost: money("internal_cost").notNull().default("0"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_bill_lines_bill").on(t.billId, t.sortOrder),
    // THE DOUBLE-BILLING GUARD. A phase or delivered material appears on exactly
    // one line across the whole system, enforced by the database rather than by
    // a code path someone might forget to write.
    uniqueIndex("idx_bill_lines_source")
      .on(t.sourceType, t.sourceId)
      .where(sql`source_id is not null`),
  ]
);

/** Append-only for every role including owner (ADR-007). */
export const billEvents = pgTable(
  "bill_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    fromStatus: billStatus("from_status"),
    toStatus: billStatus("to_status").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => profiles.id),
    note: text("note"),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_bill_events_bill").on(t.billId, t.createdAt)]
);

/**
 * A table rather than a paid_amount column, because part-payment is normal in
 * Indian construction. Outstanding = Σ net_payable (certified/paid) − Σ amount.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id),
    amount: money("amount").notNull(),
    paidOn: date("paid_on").notNull(),
    mode: text("mode"),
    referenceNo: text("reference_no"),
    note: text("note"),
    /** Client-generated, from the Record Payment dialog. */
    idempotencyKey: text("idempotency_key"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_payments_bill").on(t.billId),
    index("idx_payments_org").on(t.orgId),
    uniqueIndex("payments_idem_uq")
      .on(t.billId, t.idempotencyKey)
      .where(sql`idempotency_key is not null`),
  ]
);
