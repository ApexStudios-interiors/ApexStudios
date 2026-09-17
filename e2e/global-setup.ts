import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

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
