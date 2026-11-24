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

/**
 * Mirrors migration 20261124100009 (APX-38): the per-username sign-in
 * throttle. Keyed by sha256 of the normalised username, never the username
 * itself. No RLS policy at all — rpc_login_allowed / rpc_login_record_failure
 * (security definer) are the only way in.
 */
export const loginThrottle = pgTable("login_throttle", {
  usernameHash: text("username_hash").primaryKey(),
  windowStart: tsz("window_start").notNull().defaultNow(),
  failures: integer("failures").notNull().default(0),
});
