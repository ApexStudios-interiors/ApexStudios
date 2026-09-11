import { integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { profiles } from "./identity";
import { tsz } from "./columns";

/**
 * Mirrors migration 20260914090001. build/07-stock-inventory-notifications.md
 * §2.7's rate limiter for `searchAll` — a plain locked-row sliding-window
 * counter (no Redis/Upstash in this stack). No RLS policy at all
 * (rpc_check_rate_limit, security definer, is the only intended path in) —
 * see that migration's own comment for why.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id),
    action: text("action").notNull(),
    windowStart: tsz("window_start").notNull().defaultNow(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.action] })]
);
