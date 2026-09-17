import { chromium, type FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

/**
 * Establishes one real, signed-in storage state per role before the suite
 * runs — code-standards §9: "saved storage state per role", the fixture every
 * later e2e test reuses.
 *
 * Staff (owner/admin/site) sign in with the seeded password
 * (supabase/seed.sql: "apex-dev-only" for every account) through the real
 * /login form — no shortcut, this exercises the actual flow.
 *
 * There is no two-factor step for any role (D48), so both staff accounts
 * land on "/" straight after the password.
 *
 * The client role signs in by magic link instead, and delivery needs SMTP,
 * which is not configured (build/01-foundations.md §0.4). Rather than skip the
 * client journey, this uses the Auth ADMIN API's `generateLink`, which
 * produces the same verification token GoTrue would have emailed, without
 * sending anything — a standard, documented way to test a magic-link flow
 * without a mail server. It needs SUPABASE_SERVICE_ROLE_KEY, which is fine
 * here: this runs in Node before any browser opens, not inside the
 * application's request path, the same category of use as
 * scripts/spike-d15.mjs.
 *
 * `generateLink`'s own `action_link` redirects through GoTrue's implicit
 * flow — tokens land in a URL FRAGMENT, which the server never sees at all
 * (fragments never leave the browser), so app/(auth)/auth/callback/route.ts
 * cannot consume it; there is no end-user browser here to hold a PKCE
 * code_verifier for an admin-issued link either. Using `hashed_token` against
 * the callback's `token_hash`+`type` path instead avoids the fragment
 * entirely — see that route's own comment for why accepting this shape is
 * correct there, not just convenient here.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const STAFF: { role: "admin" | "site"; email: string }[] = [
  { role: "admin", email: "suresh@beapex.in" },
  { role: "site", email: "ravi@beapex.in" },
];
const CLIENT_EMAIL = "tvrao@example.invalid";
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? SITE_URL;
  mkdirSync("e2e/.auth", { recursive: true });

  const browser = await chromium.launch();

  for (const { role, email } of STAFF) {
    const page = await browser.newPage({ baseURL });
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    // exact: the show/hide button is labelled "Show password", which a
    // substring match would also hit.
    await page.getByLabel("Password", { exact: true }).fill("apex-dev-only");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");
    await page.context().storageState({ path: `e2e/.auth/${role}.json` });
    await page.close();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "global-setup needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }
  const admin = createClient(url, serviceKey);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: CLIENT_EMAIL });
  if (error || !data.properties?.hashed_token) {
    throw new Error(
      `could not generate the client magic link: ${error?.message ?? "no hashed_token returned"}`
    );
  }

  const clientPage = await browser.newPage({ baseURL });
  await clientPage.goto(`/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`);
  await clientPage.waitForURL("/");
  await clientPage.context().storageState({ path: "e2e/.auth/client.json" });
  await clientPage.close();

  await browser.close();
}
