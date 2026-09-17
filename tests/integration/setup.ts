/**
 * Refuses to run without a database, and refuses to run against production.
 *
 * docs/build/02-database.md §5.3, and docs/decisions.md D49: there is exactly
 * one Supabase project and it is production, so this suite — which inserts,
 * updates and deletes fixture rows over a privileged connection AND through
 * signed-in supabase-js sessions — must be pointed somewhere else or not run
 * at all. The check is the shared one every db:* script uses.
 *
 * Both halves of the target are checked, not just the database URL: the
 * suite's supabase-js clients write through NEXT_PUBLIC_SUPABASE_URL, so a
 * non-production SUPABASE_DB_URL paired with the live API URL would still
 * mutate production.
 */
import { checkProductionTarget } from "../../scripts/lib/db-target.mjs";

const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;

if (!url || url.includes("placeholder")) {
  throw new Error(
    "Integration tests need SUPABASE_DB_URL pointing at a migrated, seeded, " +
      "non-production database. D14 removed the local stack, and D49 left one " +
      "Supabase project, which is production — so this needs a database of its own."
  );
}

const { refuse, warn } = checkProductionTarget(
  [url, process.env.NEXT_PUBLIC_SUPABASE_URL],
  "the integration tests"
);
if (warn) console.warn(warn);
if (refuse) throw new Error(refuse);

export const DB_URL = url;
