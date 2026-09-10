import { numeric, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The shared column vocabulary from 02-lld.md §1.2 and §1.3.
 *
 * Money is numeric(14,2), quantity numeric(14,3), percentage numeric(6,3).
 * Never float, real, double precision or money — a floating-point currency value
 * is a rejected PR (AGENTS.md database rule 3).
 *
 * `mode: "string"` on every numeric is deliberate: Postgres numeric does not fit
 * a JavaScript number without loss, so it crosses the boundary as a string and
 * arithmetic happens in decimal.js or in Postgres. lib/money accepts both.
 */
export const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "string" });
export const quantity = (name: string) => numeric(name, { precision: 14, scale: 3, mode: "string" });
export const percentage = (name: string) => numeric(name, { precision: 6, scale: 3, mode: "string" });

/** Timestamps are always stored UTC and rendered IST (02-lld.md §1.2). */
export const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

/** Every business table carries these (02-lld.md §1.3). */
export const auditColumns = {
  createdAt: tsz("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedAt: tsz("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  deletedAt: tsz("deleted_at"),
};
