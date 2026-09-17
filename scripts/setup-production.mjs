/**
 * Sets up the dedicated PRODUCTION Supabase project (open issue #5).
 *
 * Until this existed, Vercel Production, local development and CI all used
 * one project — so CI's seed and integration tests wrote into the live
 * database on every pull request. After this, the old project is apex-dev
 * only, and production is a clean project with no demo data.
 *
 *   node scripts/setup-production.mjs
 *
 * Reads the new project's values from `.env.production.local` (gitignored —
 * see .env.production.example). Safe to re-run: every step checks before it
 * acts. It:
 *
 *   1. refuses if those values point at the development project
 *   2. applies every migration (never seed.sql) and refuses if demo rows exist
 *   3. creates the org row, then the real staff accounts you type in
 *   4. checks the dashboard settings it cannot set: sign-ups off, the access
 *      token hook registered, token lifetime 30 minutes
 *   5. saves SUPABASE_PROD_DB_URL / SUPABASE_PROD_PROJECT_REF to GitHub (for the
 *      nightly backup and CI's production guard) and the ref to .env.local
 *   6. prints which Vercel Production variables to change
 *
 * Prints no secret values.
 */
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import readline from "node:readline";
import { parse } from "dotenv";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const PROD_FILE = ".env.production.local";
const SEED_ID_PREFIX = "00000000-0000-4000-8000-";

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}
function step(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`);
}
const refOf = (url) => {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
};

// ── Prompts: one interface and a line queue, so a fast paste is never lost ──
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let hiding = false;
const writeToOutput = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => {
  if (!hiding) writeToOutput(s);
};
const lines = [];
const waiters = [];
rl.on("line", (line) => (waiters.length ? waiters.shift()(line) : lines.push(line)));
rl.on("close", () => waiters.splice(0).forEach((w) => w("")));
async function ask(question, { hidden = false, fallback = "" } = {}) {
  process.stdout.write(question);
  hiding = hidden;
  const answer = lines.length ? lines.shift() : await new Promise((resolve) => waiters.push(resolve));
  hiding = false;
  if (hidden) process.stdout.write("\n");
  return answer.trim() || fallback;
}

// ── 1. Load and sanity-check both environments ───────────────────────────────
step("1/6  Check the values point at a NEW project");
if (!existsSync(PROD_FILE)) {
  fail(`${PROD_FILE} not found. Copy .env.production.example to ${PROD_FILE} and fill it in.`);
}
const prod = parse(readFileSync(PROD_FILE));
const dev = existsSync(".env.local") ? parse(readFileSync(".env.local")) : {};
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
]) {
  if (!prod[key] || prod[key].includes("YOUR-") || prod[key].includes("replace-with")) {
    fail(`${key} is missing or still a placeholder in ${PROD_FILE}.`);
  }
}
const prodRef = refOf(prod.NEXT_PUBLIC_SUPABASE_URL);
const devRef = refOf(dev.NEXT_PUBLIC_SUPABASE_URL);
if (!prodRef) fail("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
if (prodRef === devRef) {
  fail(
    `${PROD_FILE} points at the DEVELOPMENT project (${devRef}). Use the new production project's values.`
  );
}
if (!prod.DATABASE_URL.includes(prodRef)) {
  fail(`DATABASE_URL is not for project ${prodRef}. Copy the Session pooler string from the NEW project.`);
}
for (const key of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"]) {
  if (dev[key] && dev[key] === prod[key]) fail(`${key} is the same as in .env.local (development).`);
}
console.log(`✓ Production project: ${prodRef}   Development project: ${devRef ?? "(no .env.local)"}`);

const sql = postgres(prod.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const admin = createClient(prod.NEXT_PUBLIC_SUPABASE_URL, prod.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
try {
  await sql`select 1`;
} catch (e) {
  fail(`Could not connect with DATABASE_URL: ${e.message}. Use the Session pooler string (port 5432).`);
}

// ── 2. Migrations only, never the seed ───────────────────────────────────────
step("2/6  Apply migrations (no demo data)");
const pushed = spawnSync("pnpm", ["exec", "supabase", "db", "push", "--db-url", prod.DATABASE_URL, "--yes"], {
  stdio: "inherit",
});
if (pushed.status !== 0) fail("Applying migrations failed (output above). Nothing else was changed.");
const [{ n: units }] = await sql`select count(*)::int as n from public.units`;
if (units === 0) fail("Migrations ran but public.units is empty — something is wrong with this project.");
const [{ n: seedRows }] = await sql`
  select (select count(*) from public.orgs where id::text like ${SEED_ID_PREFIX + "%"})
       + (select count(*) from public.profiles where id::text like ${SEED_ID_PREFIX + "%"}) as n`;
if (Number(seedRows) > 0) {
  fail("This database contains DEMO seed rows. A production project must never be seeded. Stopping.");
}
console.log("✓ Migrations applied, reference data present, no demo data");

// ── 3. Org and real accounts ─────────────────────────────────────────────────
step("3/6  Company and staff accounts");
let [org] = await sql`select id, name from public.orgs order by created_at limit 1`;
if (org) {
  console.log(`✓ Org already exists: ${org.name}`);
} else {
  const name = await ask("Company name [Apex Studios]: ", { fallback: "Apex Studios" });
  // Legal name, GSTIN, PAN, address and bank details stay empty until they are
  // supplied (open issue #6) — never placeholder text in production.
  [org] = await sql`insert into public.orgs (name) values (${name}) returning id, name`;
  console.log(`✓ Created org: ${org.name}`);
}

const createdLogins = [];
const [{ n: ownerCount }] = await sql`
  select count(*)::int as n from public.profiles where role = 'owner' and deleted_at is null`;
let needOwner = ownerCount === 0;
console.log(
  needOwner
    ? "No owner account yet — create it first."
    : `✓ ${ownerCount} owner account(s) exist. You can add more staff now or press Enter to skip.`
);

for (;;) {
  const role = needOwner
    ? "owner"
    : await ask("Add an account? Role (owner/admin/site) or Enter to finish: ");
  if (!role) break;
  if (!["owner", "admin", "site"].includes(role)) {
    console.log("  Role must be owner, admin or site. (Clients sign in by magic link and are added later.)");
    continue;
  }
  const fullName = await ask(`  Full name (${role}): `);
  const email = (await ask("  Email: ")).toLowerCase();
  if (!fullName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.log("  A full name and a valid email are required. Try again.");
    continue;
  }
  const [existing] = await sql`select id from public.profiles where lower(email) = ${email}`;
  if (existing) {
    console.log(`  ✓ ${email} already has an account — skipped.`);
    needOwner = false;
    continue;
  }
  const password = await ask("  Password (min 12 characters, hidden): ", { hidden: true });
  const confirm = await ask("  Type it again (hidden): ", { hidden: true });
  if (password.length < 12) {
    console.log("  Too short — at least 12 characters. Try again.");
    continue;
  }
  if (password !== confirm) {
    console.log("  The two passwords did not match. Try again.");
    continue;
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    console.log(`  ✗ Could not create ${email}: ${error.message}`);
    continue;
  }
  try {
    await sql`
      insert into public.profiles (id, org_id, full_name, email, role)
      values (${created.user.id}, ${org.id}, ${fullName}, ${email}, ${role})`;
  } catch (e) {
    // Never leave a login without a profile: getSession() would reject it.
    await admin.auth.admin.deleteUser(created.user.id);
    console.log(`  ✗ Could not create the profile for ${email} (${e.message}); the login was removed.`);
    continue;
  }
  console.log(`  ✓ Created ${role}: ${fullName} <${email}>`);
  createdLogins.push({ email, password, role });
  needOwner = false;
}

// ── 4. Dashboard settings a migration cannot set ─────────────────────────────
step("4/6  Check Supabase dashboard settings");
const problems = [];

const probeEmail = `signup-probe-${Date.now()}@example.invalid`;
const anon = createClient(prod.NEXT_PUBLIC_SUPABASE_URL, prod.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: probe, error: probeError } = await anon.auth.signUp({
  email: probeEmail,
  password: `Probe-${crypto.randomUUID()}`,
});
if (!probeError) {
  problems.push(
    "Public sign-ups are ON. Authentication → Sign In / Providers → turn off “Allow new users to sign up”."
  );
  if (probe.user) await admin.auth.admin.deleteUser(probe.user.id);
} else {
  console.log("✓ Public sign-ups are off");
}

const login = createdLogins[0];
if (login) {
  const { data: session, error } = await anon.auth.signInWithPassword({
    email: login.email,
    password: login.password,
  });
  if (error || !session.session) {
    problems.push(
      `Could not sign in as ${login.email} to check the token (${error?.message ?? "no session"}).`
    );
  } else {
    const claims = JSON.parse(
      Buffer.from(session.session.access_token.split(".")[1], "base64url").toString()
    );
    if (claims.app_metadata?.app_role !== login.role || !claims.app_metadata?.org_id) {
      problems.push(
        "The access token hook is NOT registered. Authentication → Hooks → Customize Access Token → " +
          "public.custom_access_token_hook → Enable. Without it every user is treated as a site supervisor."
      );
    } else {
      console.log(`✓ Access token hook registered (token says role: ${claims.app_metadata.app_role})`);
    }
    const ttl = claims.exp - claims.iat;
    if (ttl > 1800) {
      problems.push(
        `Access token lifetime is ${ttl}s. Set it to 1800 (Project Settings → JWT Keys → Access token expiry time).`
      );
    } else {
      console.log(`✓ Access token lifetime ${ttl}s`);
    }
    await anon.auth.signOut();
  }
} else {
  console.log("  (No account created this run, so the token hook check was skipped.)");
}

// ── 5. GitHub secrets and the local production guard ─────────────────────────
step("5/6  GitHub secrets and local guard");
const saveSecrets = await ask(
  "Save SUPABASE_PROD_DB_URL and SUPABASE_PROD_PROJECT_REF to GitHub now? [Y/n]: ",
  { fallback: "y" }
);
if (saveSecrets.toLowerCase().startsWith("y")) {
  for (const [name, value] of [
    ["SUPABASE_PROD_DB_URL", prod.DATABASE_URL],
    ["SUPABASE_PROD_PROJECT_REF", prodRef],
  ]) {
    execFileSync("gh", ["secret", "set", name], { input: value, stdio: ["pipe", "ignore", "inherit"] });
    console.log(`✓ Saved GitHub secret ${name}`);
  }
} else {
  console.log("  Skipped. The nightly backup and CI guard need them — re-run this script to save them.");
}
if (existsSync(".env.local") && dev.SUPABASE_PROD_PROJECT_REF !== prodRef) {
  if (dev.SUPABASE_PROD_PROJECT_REF) {
    console.log(
      `! .env.local has SUPABASE_PROD_PROJECT_REF=${dev.SUPABASE_PROD_PROJECT_REF}; change it to ${prodRef}.`
    );
  } else {
    appendFileSync(
      ".env.local",
      `\n# Guard: db:seed / db:reset / test:rls refuse this project.\nSUPABASE_PROD_PROJECT_REF=${prodRef}\n`
    );
    console.log("✓ Added SUPABASE_PROD_PROJECT_REF to .env.local (local db scripts now refuse production)");
  }
}

rl.close();
await sql.end({ timeout: 5 });

// ── 6. What is left: Vercel ──────────────────────────────────────────────────
step("6/6  Vercel (do this yourself)");
console.log(`In Vercel → apex-studios → Settings → Environment Variables, for PRODUCTION only,
set these four to the values in ${PROD_FILE}:

  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  DATABASE_URL

Preview and Development keep the development values. Then Deployments →
latest → ⋯ → Redeploy (NEXT_PUBLIC_ values only change on a new build).`);

if (problems.length) {
  console.log("\n✗ Fix these in the Supabase dashboard, then run this script again:");
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  process.exit(1);
}
console.log("\n✓ Production database is ready.");
