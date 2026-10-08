import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { config as loadEnv } from "dotenv";
// The same guard the db:* scripts use, so all five entry points ask
// "is this production?" identically rather than each inventing an answer.
import { checkProductionTarget } from "../scripts/lib/db-target.mjs";

loadEnv({ path: ".env.local", quiet: true });

/**
 * The production guard `pnpm test:e2e` did not have.
 *
 * `db:reset`, `db:seed`, `test:rls` and `test:integration` all refuse when
 * their target resolves to SUPABASE_PROD_PROJECT_REF. This suite did not: it
 * was a bare `playwright test`, and AGENTS.md's "never run it against
 * production" was the only thing standing between it and the live database.
 *
 * That was not enough. Production holds test-created rows — an "E2E Test
 * Project", phases and bills named after Playwright run ids, and a
 * `projects.next_bill_seq` of 1341 behind only 10 surviving bills, i.e. more
 * than a thousand bills created and deleted here. The RA numbers of real,
 * issued invoices now have gaps in them because of it.
 *
 * This suite SIGNS IN and WRITES, so the check is the same refusal the other
 * four make, not a warning. It reads the Supabase URL (that is what the app
 * under test talks to) as well as DATABASE_URL, because a run pointed at a
 * local app with production credentials is the exact case that did the damage.
 */
function refuseProductionTarget(): void {
  const { refuse, warn } = checkProductionTarget(
    // SUPABASE_DB_URL too: the specs' own dbConnect() prefers it over
    // DATABASE_URL, so a production SUPABASE_DB_URL must not slip past.
    [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_DB_URL, process.env.DATABASE_URL],
    "the Playwright e2e suite"
  );
  // A WARNING IS TREATED AS A REFUSAL HERE, unlike in the db:* scripts.
  // `checkProductionTarget` downgrades "I cannot prove this is not production"
  // to a warning on an interactive run, on the reasoning that a developer who
  // has not filled in .env.local yet is not the failure mode. For this suite
  // that reasoning does not hold: an interactive `pnpm test:e2e` on a laptop
  // with real credentials in .env.local is PRECISELY what wrote a thousand
  // bills into the live database. An unprovable target is a refusal.
  const problem = refuse ?? warn;
  if (problem) {
    // Throwing, not process.exit: Playwright reports a failed global setup,
    // and a bare exit code is easy to miss in a reporter's output.
    throw new Error(
      `${problem}\n\n  Set SUPABASE_PROD_PROJECT_REF in .env.local, and point this suite at a\n` +
        "  non-production database before running it."
    );
  }
}

/**
 * Establishes one real, signed-in storage state per role before the suite
 * runs — code-standards §9: "saved storage state per role", the fixture every
 * later e2e test reuses.
 *
 * Every role signs in the same way (D51): username + password through the real
 * /login form, with the seeded password (supabase/seed.sql: "apex-dev-only"
 * for every account) — no shortcut, this exercises the actual flow. There is
 * no two-factor step for any role (D48), so each lands on "/" straight after
 * the password.
 *
 * The seeded client's address is not on the Apex domain, so it signs in with
 * the full address, which the Username field also accepts
 * (features/users/service.ts signInEmail). Before D51 the client was signed in
 * through a service-role `generateLink` magic link; that route is gone.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const ACCOUNTS: { role: "admin" | "site" | "client"; username: string }[] = [
  { role: "admin", username: "suresh" },
  { role: "site", username: "ravi" },
  { role: "client", username: "tvrao@example.invalid" },
];

export default async function globalSetup(config: FullConfig) {
  // Before a browser is launched or a single row is written.
  refuseProductionTarget();

  const baseURL = config.projects[0]?.use.baseURL ?? SITE_URL;
  mkdirSync("e2e/.auth", { recursive: true });

  const browser = await chromium.launch();

  for (const { role, username } of ACCOUNTS) {
    const page = await browser.newPage({ baseURL });
    await page.goto("/login");
    await page.getByLabel("Username").fill(username);
    // exact: the show/hide button is labelled "Show password", which a
    // substring match would also hit.
    await page.getByLabel("Password", { exact: true }).fill("apex-dev-only");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");
    await page.context().storageState({ path: `e2e/.auth/${role}.json` });
    await page.close();
  }

  await browser.close();
}
