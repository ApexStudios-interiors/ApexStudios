# Apex Projects — Open Issues

As of 2026-09-17. Production is live at https://apex-studios-eight.vercel.app, running `main` @ `2b1e083`
(`/api/health`: db ✓, r2 ✓). `jobs.drain` and `jobs.reap` run successfully from GitHub Actions.

Suggested order: **4 → 3 → 5** (1 and 2 resolved), then **6–9** before the first real bill, and **10–11** before go-live.

---

## Fix now

### 1. Nightly backup fails at the R2 upload — ✅ RESOLVED 2026-09-17

- **Cause:** the GitHub secrets held the read-only token, then a mismatched key ID and secret. Separately,
  middleware redirected `/api/backup/report` to `/login`, so outcomes were never recorded, and Vercel
  lacked the read-only keys `backup.verify` needs.
- **Fixed:** GitHub secrets now hold `apex-backups-write` (Object Read & Write), set with
  `node scripts/set-backup-secrets.mjs`, which write-tests the pair before saving. The report route is
  exempt from the login redirect. Vercel Production has the read-only keys.
- **Verified:** run 35191930136 on `main` passed every step; `pg_dump/2026-09-17.sql.gz` is in
  `apex-backups`; `backup.nightly` and `backup.verify` are both `succeeded` in `jobs`.
- **To rotate the write token later:** roll it in Cloudflare, then run `node scripts/set-backup-secrets.mjs`.

### 2. PR #21 is not merged — ✅ RESOLVED 2026-09-17

- PR #21 merged (`2b1e083`), PR #20 closed. `main` dumps with PostgreSQL 17.

### 3. Owner and admins cannot use the app — ✅ FIXED IN PR #23 (merge to deploy)

- **Decision D48:** no two-factor for any role. Staff sign in with email + password; the password field
  has a show/hide button. The aal2 requirement that blocked every admin action is removed.
- **Consequence:** owner/admin accounts rely on their password alone, so issue 4 is now more urgent.

### 4. Public demo logins on the live site

- **Issue:** Every seeded account uses the password `apex-dev-only`, which is committed in
  `supabase/seed.sql`. Anyone who can read the repo can log in to production (the Site Supervisor account
  works fully today).
- **Fix:** Change these passwords in Supabase → Authentication → Users, or delete the demo accounts,
  before any real data goes in.

### 5. Production and development share one database — 🔧 IN PROGRESS (PR #25)

- **Issue:** Vercel Production, `.env.local` and CI all use project `fyrywwatmvmqxrowscmp`. CI's
  `database` job runs migrations, `db:seed` and the integration tests against it on every PR, so the
  live site's data is demo seed plus test rows (`E2E Test Project …`), and the nightly backup was of that.
  No real business data exists in it (checked 2026-09-17).
- **Fix:** keep that project as **apex-dev** (local, CI, PR previews). Create a clean **apex-prod**
  project and run `node scripts/setup-production.mjs`: migrations only, no seed, real staff accounts,
  dashboard-setting checks, GitHub secrets `SUPABASE_PROD_DB_URL` / `SUPABASE_PROD_PROJECT_REF`.
  Then point Vercel **Production** at it. The backup now dumps `SUPABASE_PROD_DB_URL` only, and CI
  refuses to run against the production ref.
- **Follow-up:** the R2 app bucket is still shared by dev and production.

---

## Before issuing any real bill

### 6. Company legal identity is placeholder data

- **Issue:** Legal name, GSTIN, PAN, registered address and bank details are placeholders in
  `supabase/seed.sql`. They print on every tax invoice. This is also why the `inputs on hold` CI check
  fails on every PR.
- **Fix:** Provide the real values and replace the placeholders.

### 7. Tax questions await CA confirmation

- **Issue:** Still unconfirmed: material-at-site treatment (D4), statutory retention period (A-5), the
  five tax questions in `01-hld.md` §8.4, and CGST/SGST split versus one `gst_amount` (D45).
- **Fix:** Get written answers from the CA and record each in `docs/decisions.md` with name and date.

### 8. Bill PDF never checked against a real bill

- **Issue:** No real past RA bill was supplied, so the generated PDF layout is a placeholder and could
  not be verified. CA sign-off on a generated PDF is also outstanding.
- **Fix:** Supply one real past RA bill, compare the generated equivalent, and get CA sign-off in writing.

### 9. Small billing correctness gaps

- **Issue:**
  - Recording a payment does not regenerate the bill PDF, so it can be stale.
  - `RecordPaymentDialog` does not regenerate its idempotency key after a failed submit.
  - `BillingAdmin`'s "Billable Now" table does not refresh after a bill is created, which can cause a
    confusing `ALREADY_BILLED` on resubmit.
- **Fix:** Three small code fixes in `features/billing`.

---

## Platform and operations

### 10. Vercel Hobby forbids commercial use

- **Issue:** Hobby's terms don't allow commercial use, and this system issues GST tax invoices.
- **Fix:** Upgrade to Vercel Pro before go-live (ADR-016).

### 11. No point-in-time database recovery

- **Issue:** Supabase Free has no point-in-time recovery, so up to 24 hours of data could be lost.
- **Fix:** Upgrade to Supabase Pro (ADR-016), which brings recovery point to about 15 minutes.

### 12. `migrations · seed · RLS · drift` CI check fails

- **Issue:** The integration tests exhaust Supabase's sign-in rate limit on the shared development
  project, then collide on leftover fixtures. Fails on `main` too.
- **Fix:** Run these tests against a Supabase preview branch, or sign each test user in once and reuse
  the session across tests.

### 13. Bill PDFs can take about 5 minutes

- **Issue:** `jobs.drain` runs from GitHub Actions, whose shortest schedule is 5 minutes (and often
  later). The old 60-second PDF target is relaxed to 5 minutes (D47).
- **Fix:** Trigger a drain straight after a bill is submitted, keeping the scheduled run as a fallback.
  Or move the schedule back to Vercel Cron after upgrading to Pro.

### 14. GitHub can silently disable the job schedules

- **Issue:** GitHub turns off scheduled workflows after 60 days with no repository activity. Drain and
  reap would stop without warning.
- **Fix:** Check the Actions tab after any quiet period. Upgrading to Vercel Pro and moving the
  schedules back to Vercel Cron removes the risk.

### 15. Sentry still present

- **Issue:** Sentry was ruled out of scope but remains in the code and docs.
- **Fix:** In one PR, remove `@sentry/nextjs`, its calls in `lib/jobs/runner.ts`, the `SENTRY_DSN`
  variable (`lib/env.ts`, `scripts/check-env.mjs`, `.env.example`) and the documentation references.

### 16. Dependency update PRs pending

- **Issue:** Six Dependabot PRs are open: #3, #4, #5, #6 (GitHub Actions versions), #16 (production
  dependencies) and #17 (development dependencies).
- **Fix:** Review each and merge those whose CI stays green.

---

## Legal

### 17. Data protection obligations undefined

- **Issue:** Obligations under India's DPDP Act 2023 (`architecture.md` §12) have not been set out.
- **Fix:** Get the obligation list from counsel before launch.
