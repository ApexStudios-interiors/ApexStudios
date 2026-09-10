import { bigint, bigserial, index, inet, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { appRole, attachmentEntity } from "./enums";
import { tsz } from "./columns";
import { orgs, profiles } from "./identity";
import { projects } from "./projects";

/** Mirrors migration 0011. */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    entityType: attachmentEntity("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** Private bucket, presigned URLs only (ADR-008). */
    r2Key: text("r2_key").notNull().unique(),
    thumbR2Key: text("thumb_r2_key"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    // bigint in SQL; "number" mode is safe because the check constraint caps
    // this at 25 MB, far inside Number.MAX_SAFE_INTEGER.
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => profiles.id),
    createdAt: tsz("created_at").notNull().defaultNow(),
    deletedAt: tsz("deleted_at"),
  },
  (t) => [
    index("idx_att_entity").on(t.entityType, t.entityId),
    index("idx_att_project").on(t.projectId),
    index("idx_att_org").on(t.orgId),
    index("idx_att_uploader").on(t.uploadedBy),
  ]
);

/**
 * Append-only for every role including owner (ADR-007). Written only by
 * public.fn_audit, in the same transaction as the change it records.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    orgId: uuid("org_id").notNull(),
    actorId: uuid("actor_id"),
    actorRole: appRole("actor_role"),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip"),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_audit_entity").on(t.entityType, t.entityId, t.createdAt),
    index("idx_audit_actor").on(t.actorId, t.createdAt),
    index("idx_audit_org").on(t.orgId),
  ]
);
