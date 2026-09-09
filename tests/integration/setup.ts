/**
 * Refuses to run without a database, and refuses to run against production.
 *
 * docs/build/02-database.md §5.3.
 */
const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;

if (!url || url.includes("placeholder")) {
  throw new Error(
    "Integration tests need SUPABASE_DB_URL pointing at a migrated, seeded, " +
      "non-production database. D14 removed the local stack, so this is the " +
      "linked apex-dev project or a pull request's Supabase preview branch."
  );
}

const prod = process.env.SUPABASE_PROD_PROJECT_REF?.trim();
if (prod && url.includes(prod)) {
  throw new Error("Refusing to run integration tests against production.");
}

export const DB_URL = url;
