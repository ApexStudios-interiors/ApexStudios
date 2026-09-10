import { chromium, type FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { generateTotp } from "./totp";

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
 * `requireRole`'s `requireAalForRole` (lib/auth/session.ts) hard-requires
 * AAL2 for owner/admin, unconditionally, in every environment — there is no
 * dev bypass. No seeded account had an MFA factor enrolled and there is no
 * enrollment UI yet (build/03-auth-and-rbac.md built the CHALLENGE step, for
 * a factor that already exists, not enrollment) — found live, not in review,
 * while build/04-projects-packages-phases.md's admin Playwright journey
 * tried to call its first `adminAction` and got FORBIDDEN every time.
 * `ensureAdminTotpEnrolled` below is the dev-only fix: it enrolls and
 * verifies a real TOTP factor for the seeded admin account directly through
 * `supabase-js` (there is nowhere else to do it from), once, and persists
 * the secret locally so every run after the first can compute a fresh code
 * for the real `/login` challenge step below — the same challenge a human
 * with an authenticator app would complete. Building the actual enrollment
 * UI remains an open gap; see docs/decisions.md D22.
 *
 * The client role cannot do the same: magic-link delivery needs SMTP, which
 * is not configured (build/01-foundations.md §0.4). Rather than skip the
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
const ADMIN_EMAIL = "suresh@beapex.in";
const TOTP_SECRET_PATH = "e2e/.auth/admin-totp-secret.txt";

/**
 * Enrolls (once) and returns a verified TOTP secret for the seeded admin
 * account, so the real `/login` MFA challenge below can be completed on
 * every run. See this file's header comment for why this exists at all.
 */
async function ensureAdminTotpEnrolled(url: string, anonKey: string): Promise<string> {
  if (existsSync(TOTP_SECRET_PATH)) {
    return readFileSync(TOTP_SECRET_PATH, "utf8").trim();
  }

  const supabase = createClient(url, anonKey);
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: "apex-dev-only",
  });
  if (signInError) throw new Error(`could not sign in as ${ADMIN_EMAIL} to enroll MFA: ${signInError.message}`);

  // Clean slate: a factor from a previous, interrupted run would be
  // "unverified" and unusable (its secret is gone), and would otherwise pile
  // up across runs.
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (enrollError || !enrolled.totp.secret) {
    throw new Error(`could not enroll a TOTP factor: ${enrollError?.message ?? "no secret returned"}`);
  }
  const secret = enrolled.totp.secret;

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: enrolled.id,
  });
  if (challengeError) throw new Error(`could not challenge the new factor: ${challengeError.message}`);

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: enrolled.id,
    challengeId: challenge.id,
    code: generateTotp(secret),
  });
  if (verifyError) throw new Error(`could not verify the new factor: ${verifyError.message}`);

  await supabase.auth.signOut();
  writeFileSync(TOTP_SECRET_PATH, secret);
  return secret;
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? SITE_URL;
  mkdirSync("e2e/.auth", { recursive: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error("global-setup needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  }
  const adminTotpSecret = await ensureAdminTotpEnrolled(supabaseUrl, anonKey);

  const browser = await chromium.launch();

  for (const { role, email } of STAFF) {
    const page = await browser.newPage({ baseURL });
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("apex-dev-only");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Only the admin account has a TOTP factor enrolled (above) — site never
    // hits requireAalForRole's check at all, so it lands on "/" directly.
    if (role === "admin") {
      await page.getByLabel("Code").fill(generateTotp(adminTotpSecret));
      await page.getByRole("button", { name: "Verify" }).click();
    }
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
