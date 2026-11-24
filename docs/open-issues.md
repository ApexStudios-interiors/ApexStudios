# Apex Projects — Open Issues

As of 2026-11-24, against `main` @ `ab533ac`. Production runs at https://apex-studios-eight.vercel.app.

This file lists open **business, operational and legal** items — things a person has to decide, supply or
buy. Code defects found in the November 2026 audit are tracked one by one, by `APX-` id, in the audit
tracker and fixed in their own PRs; they are not repeated here. Where an item below has an APX id, the
fix is in flight under that id.

Resolved since the last revision (2026-09-17) and dropped from this list: the nightly backup upload,
PR #21, the two-factor lockout (D48, then username + password for every role, D51), the separate
production database proposal (superseded by D49), Sentry (removed entirely, D50), and two of the three
small billing gaps (the payment idempotency key and the Billable Now refresh are both fixed in
`features/billing/components`).

---

## Before any real data goes in

### 1. Public demo logins

- **Issue:** `supabase/seed.sql` still gives every seeded account the password `apex-dev-only`, and the
  repository is public. Any seeded account that still exists in production with that password can be
  signed into by anyone.
- **Fix:** In Supabase → Authentication → Users, change the password of every seeded account or delete
  it, before real business data is entered. Confirm by trying the seeded password.

### 2. There is no non-production database (D49)

- **Issue:** The one Supabase project is production. Nothing destructive can be tried anywhere, and the
  database tests (pgTAP, integration, drift) have had nowhere safe to run since CI was paused on
  2026-09-17.
- **Fix (in flight, APX-13):** CI's `database` job runs against a throwaway local Supabase started on the
  GitHub runner, never the live project (`ci/local-supabase-db`). Once merged, CI's `pull_request` and
  `push` triggers can return.

---

## Before issuing any real bill

### 3. Company legal identity is placeholder data

- **Issue:** Legal name, GSTIN, PAN, registered address and bank details in `supabase/seed.sql` are
  placeholders. They print on every tax invoice, and the `inputs on hold` CI check reports them.
- **Fix:** Provide the real values and replace the placeholders.

### 4. Tax questions await CA confirmation

- **Issue:** Still unconfirmed: material-at-site treatment (D4), the statutory retention period (A-5),
  the five tax questions in `01-hld.md` §8.4, and the CGST/SGST split versus one `gst_amount` (D45).
- **Fix:** Get written answers from the CA and record each in `docs/decisions.md` with a name and date.

### 5. Bill PDF never checked against a real bill

- **Issue:** No real past RA bill was supplied, so the PDF layout could not be verified, and CA sign-off
  on a generated PDF is outstanding.
- **Fix:** Supply one real past RA bill, compare the generated equivalent, and get CA sign-off in writing.

### 6. Recording a payment does not regenerate the bill PDF

- **Issue:** The `bill.pdf` job is enqueued on submit only (`features/billing/transition.ts`), so a PDF
  generated before a payment does not reflect it.
- **Fix:** Decide whether a paid bill's PDF should change at all (a tax invoice is normally immutable
  once issued); if it should, enqueue a new revision from `recordPayment`.

---

## Platform and operations

### 7. Vercel Hobby forbids commercial use

- **Issue:** Hobby's terms do not allow commercial use, and this system issues GST tax invoices.
- **Fix:** Upgrade to Vercel Pro before go-live (ADR-016). Pro also allows sub-daily Vercel Cron, which
  would remove items 9 and 10.

### 8. No point-in-time database recovery

- **Issue:** Supabase Free has no point-in-time recovery, so up to 24 hours of data can be lost, and the
  nightly backup has not yet been restored end to end (APX-19).
- **Fix:** Upgrade to Supabase Pro (ADR-016), bringing the recovery point to about 15 minutes, and
  rehearse a restore from `apex-backups`.

### 9. Background work waits on GitHub's schedule

- **Issue:** `jobs.drain` runs from GitHub Actions, whose schedule is best-effort; observed runs are hours
  apart, not every 5 minutes, so a bill PDF or a photo thumbnail can wait that long (D47).
- **Fix (in flight, APX-20):** trigger a drain straight after the work is enqueued, keeping the schedule
  as a fallback. Moving the schedule to Vercel Cron on Pro is the durable fix.

### 10. GitHub can silently disable the job schedules

- **Issue:** GitHub turns off scheduled workflows after 60 days without repository activity. Drain, reap
  and the nightly backup would stop without warning.
- **Fix:** Check the Actions tab after any quiet period. Item 7's move to Vercel Cron removes the risk for
  drain and reap.

### 11. Dependency update PRs pending

- **Issue:** Dependabot PRs #83 (production dependencies) and #84 (development dependencies) are open.
- **Fix:** Review each and merge once CI is green on it.

---

## Legal

### 12. Data protection obligations undefined

- **Issue:** Obligations under India's DPDP Act 2023 (`architecture.md` §12) have not been set out.
- **Fix:** Get the obligation list from counsel before launch.
