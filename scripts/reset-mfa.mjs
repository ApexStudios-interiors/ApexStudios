/**
 * D22 recovery: removes every MFA factor from one account, so its owner can
 * set two-factor up again at /mfa on their next sign-in (lost or replaced
 * phone). Without this, an owner who loses their authenticator is locked out
 * of every admin action for good — no aal1 session may replace a verified
 * factor, by design.
 *
 *   node scripts/reset-mfa.mjs person@example.com
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY from .env.local, i.e. whichever project that
 * file points at. Shows the account and makes you type its email back before
 * deleting anything. Verify who is asking out-of-band first: resetting MFA for
 * someone who is not the account holder hands them the account.
 */
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/reset-mfa.mjs person@example.com");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("✗ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: profile, error: profileError } = await admin
  .from("profiles")
  .select("id, full_name, role, email")
  .ilike("email", email)
  .maybeSingle();
if (profileError) {
  console.error(`✗ Could not look up ${email}: ${profileError.message}`);
  process.exit(1);
}
if (!profile) {
  console.error(`✗ No account with email ${email} in ${new URL(url).hostname}`);
  process.exit(1);
}

const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: profile.id });
if (listError) {
  console.error(`✗ Could not list factors: ${listError.message}`);
  process.exit(1);
}

console.log(`Project: ${new URL(url).hostname}`);
console.log(`Account: ${profile.full_name} <${profile.email}> (${profile.role})`);
console.log(
  `Factors: ${factors.factors.length ? factors.factors.map((f) => `${f.factor_type}/${f.status}`).join(", ") : "none"}`
);
if (factors.factors.length === 0) {
  console.log("Nothing to reset. They can set two-factor up at /mfa after signing in.");
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const typed = await rl.question("Type the email again to remove ALL of these factors: ");
rl.close();
if (typed.trim().toLowerCase() !== email) {
  console.error("✗ Did not match. Nothing was changed.");
  process.exit(1);
}

for (const factor of factors.factors) {
  const { error } = await admin.auth.admin.mfa.deleteFactor({ userId: profile.id, id: factor.id });
  if (error) {
    console.error(`✗ Could not remove factor ${factor.id}: ${error.message}`);
    process.exit(1);
  }
}
console.log(
  `✓ Removed ${factors.factors.length} factor(s). On next sign-in they will be asked to set up two-factor again.`
);
