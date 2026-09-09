import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { jobStatus } from "./enums";
import { tsz } from "./columns";
import { orgs } from "./identity";

/**
 * Mirrors migration 0012. The runner, cron routes and handlers are Build 06;
 * the table and its two RPCs land here so Build 06 starts with the concurrency
 * primitive already tested.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => orgs.id),
    name: text("name").notNull(),
    status: jobStatus("status").notNull().default("pending"),
    payload: jsonb("payload").notNull().default({}),
    /** Dedupes enqueues for the same entity; assume every job runs twice. */
    idempotencyKey: text("idempotency_key"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAfter: tsz("run_after").notNull().defaultNow(),
    /** Expiry means the worker died; the hourly reaper requeues it. */
    leaseUntil: tsz("lease_until"),
    lastError: text("last_error"),
    startedAt: tsz("started_at"),
    finishedAt: tsz("finished_at"),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_jobs_claimable")
      .on(t.runAfter)
      .where(sql`status = 'pending'`),
    index("idx_jobs_expired")
      .on(t.leaseUntil)
      .where(sql`status = 'running'`),
    index("idx_jobs_failed")
      .on(t.name, t.finishedAt)
      .where(sql`status = 'failed'`),
    index("idx_jobs_org").on(t.orgId),
  ]
);
