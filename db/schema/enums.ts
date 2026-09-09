import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Mirrors migration 0001. Postgres enums cannot drop values, only add them, so
 * these lists are load-bearing rather than descriptive.
 */
export const appRole = pgEnum("app_role", ["owner", "admin", "site", "client"]);
export const projectStatus = pgEnum("project_status", [
  "planning",
  "active",
  "on_hold",
  "completed",
  "archived",
]);
export const packageStatus = pgEnum("package_status", ["not_started", "design", "in_progress", "completed"]);
export const phaseBillingStatus = pgEnum("phase_billing_status", [
  "unresolved",
  "billable",
  "billed",
  "paid",
]);
export const stockRequestStatus = pgEnum("stock_request_status", [
  "pending",
  "approved",
  "ordered",
  "delivered",
  "rejected",
]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected"]);
export const approvalType = pgEnum("approval_type", [
  "material_sample",
  "drawing",
  "make_model",
  "milestone",
  "other",
]);
export const billStatus = pgEnum("bill_status", ["draft", "submitted", "certified", "paid", "cancelled"]);
export const billLineSource = pgEnum("bill_line_source", ["phase", "material", "manual", "adjustment"]);
export const movementDirection = pgEnum("movement_direction", ["in", "out", "adjust"]);
export const attachmentEntity = pgEnum("attachment_entity", [
  "approval",
  "daily_update",
  "bill",
  "stock_request",
  "project",
]);
export const jobStatus = pgEnum("job_status", ["pending", "running", "succeeded", "failed"]);
