import { pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { profiles } from "./identity";
import { tsz } from "./columns";

/**
 * Mirrors migration 20260928090001 (D60): per-user read state for the bell.
 * Not a notifications table — `v_notifications` is still computed live; this
 * records only that a user has seen one. `kind` and `entity_id` are
 * deliberately neither an enum nor a foreign key (see the migration).
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
