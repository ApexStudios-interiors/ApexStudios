import { pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { profiles } from "./identity";
import { tsz } from "./columns";

/**
 * Mirrors migration 20260928090001 (D60). Per-user read state for the bell:
 * `v_notifications` is still computed live, and this records only that a user
 * has seen one. `kind` and `entity_id` are deliberately not an enum or a
 * foreign key — the view is a union over unrelated tables, so `entity_id` has
 * no single referent (see that migration's own comment).
 */
export const notificationReads = pgTable(
  "notification_reads",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    entityId: uuid("entity_id").notNull(),
    readAt: tsz("read_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.kind, t.entityId] })]
);
