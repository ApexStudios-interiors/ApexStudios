# Build 10 — Hardening, Observability, Runbooks, Data Migration & Production Cutover

> **This file is a prompt.** Everything before this made the system work. This one makes it
> survivable by one maintainer.
>
> **Depends on:** Builds 01–09 complete and merged.
> **Blocks:** nothing. This is the last one.
> **Branch:** `build/10-hardening`

---

## 0. Prerequisites — what a human must do outside the codebase

### 0.1 Infrastructure

- [ ] **Supabase Pro on `apex-prod`**, with **point-in-time recovery enabled** (ADR-016). This is
      what moves the RPO from 24 hours to 15 minutes. Confirm PITR is actually on — the plan
      upgrade does not enable it by itself.
- [ ] **Vercel Pro** active, project region `bom1`, custom domain `app.beapex.in` live with TLS.
- [ ] **HSTS preload** submitted for the domain, after confirming every subdomain is HTTPS-only.
      Preload is difficult to reverse; read what you are submitting.
- [ ] **Uptime monitoring** (Better Stack, Pingdom or equivalent) hitting `/api/health` every
      minute from an Indian region, alerting after **three** consecutive failures
      (`architecture.md` §9.2).
- [ ] **Alert routing configured and tested**: site down and backup failure go to **email and
      phone**; P2s to email. Send a test alert down each channel and confirm it arrives on the
      phone that will be next to someone at 2 a.m.
- [ ] **A named owner and a recurring calendar entry for the quarterly restore drill**
      (`architecture.md` §7.2). Without a name and a date it does not happen.
- ~~**Sentry**: production environment, release tracking, alert rules, and a spend cap.~~
      **Dropped by D49** — there is no error-tracking service. Nothing to set up.

### 0.2 Compliance and legal

- [ ] **CA final sign-off** on a generated bill (carried from Build 09 §0.1) — recorded in
      writing, filed in `docs/`.
- [ ] **Counsel's DPDP Act 2023 obligation set** (`architecture.md` §12): breach notification
      process, a named contact, and the deletion-on-request procedure. The technical
      implementation — anonymise the profile, preserve the audit trail — is in §3.7; the process
      around it is not code.
- [ ] **Statutory retention period** confirmed by the CA, so the R2 lifecycle rules for archived
      projects can be written (`architecture.md` §16.5, currently "indefinite").
- [ ] **A written statement to clients** that in-app approval is an audited decision, not an
      e-signature (`architecture.md` §12).

### 0.3 Data and people

- [ ] **The real production dataset**, cleaned and signed off: clients, projects with codes and
      billing constants, packages and phases with allocated/internal budgets, tasks, opening
      inventory balances, staff list with roles and project memberships. One spreadsheet, one
      owner, one version. **This is the longest-lead item in the whole build. Start it during
      Build 04.**
- [ ] **A decision on historical bills.** Are past RA bills entered into the system, or does it
      start from the next one? Entering history means `next_bill_seq` must be set correctly per
      project and the arithmetic must reconcile to documents already issued. Starting fresh is
      simpler and usually right. Record as **D22.**
- [ ] **Training**: a session for the admins, one for Ravi on a phone, and a walkthrough with
      T V Rao. Budget an hour each. A system nobody was shown is a system nobody uses.
- [ ] **A go-live date, a freeze window, and a named person who can call a rollback.**

---

## 1. Objective

The system runs in production, its failure modes are understood and rehearsed, its promises are
tested rather than asserted, and one person can operate it.

---

## 2. Steps — completing the test estate

### 2.1 Full RLS coverage

Build 02 established the suite; Builds 03–09 added tables and RPCs. Close the gaps:

- **Every table × every role × member and non-member.** Generate the matrix from the catalogue,
  not from a hand-maintained list, so a table added later shows up as an untested cell.
- A coverage report at the end of `pnpm test:rls` printing any table with no policy test.
  A red cell blocks the build.
- Re-assert the structural checks from Build 02 §5.2 — every table has RLS and `force`, every
  policy column is indexed, every `security definer` function sets `search_path`, no float money.

### 2.2 The whole test matrix

`02-lld.md` §12 lists T-01 to T-25. Verify **every** one exists, runs in CI, and is not skipped.
Add a test that fails if any test in the suite is marked `.only`, `.skip` or `todo` — the RLS
suite in particular must not be skippable (`AGENTS.md` testing expectations).

### 2.3 Performance pass

Targets: P95 dashboard < 1.5 s, P95 mutation < 500 ms (`01-hld.md` §13).

1. Seed a **production-shaped** dataset: 20 active projects, 30k tasks, 15k attachments,
   500k audit rows (`architecture.md` §11.1 year-1 figures).
2. `explain (analyze, buffers)` on the ten hottest queries: portfolio, project dashboard,
   packages table (all three role shapes), schedule, stock list, inventory business-wide,
   Billable Now, notifications, search.
3. **Every RLS predicate column has an index** — this is the single biggest cause of Supabase
   performance collapse. Verify with a catalogue query, not by reading migrations.
4. Eliminate N+1s. Presigned URL generation per attachment row is the likely offender; batch it.
5. Confirm `React.cache()` deduplicates the session lookup between layout and page.
6. Server-side pagination on every table past 100 rows.
7. `pg_stat_statements` enabled; capture a baseline for the weekly slow-query digest.
8. Lighthouse on the three heaviest routes, mobile profile, throttled — the site supervisor's
   actual conditions.

### 2.4 Security pass

- **Content Security Policy** (`architecture.md` §6.5): `default-src 'self'`, nonce-based
  `script-src`, no `unsafe-inline`, no `unsafe-eval`, the R2 domain in `img-src` and
  `connect-src`. Ship it in report-only first, read the reports for a week, then enforce.
- Session cookies `httpOnly`, `Secure`, `SameSite=Lax`. HSTS with preload.
- **Rate limiting** on auth endpoints, the magic-link request, `requestUploadUrl` and
  `searchAll` (`architecture.md` T14). Vercel WAF plus a per-action throttle.
- `pnpm audit --audit-level=high` clean; Dependabot current.
- **A redaction test**: assert that no log line, error payload or breadcrumb contains a value
  matching a money field or a personal name (`architecture.md` §6.4). Write it as a test that
  drives real actions and inspects the captured transport, not as a review checklist.
- Run the `/security-review` skill over the full diff from `proto-v1` to `main`.
- **Verify the threat model line by line.** `architecture.md` §6.3, T1–T15: for each, name the
  test or the control that proves the mitigation exists. A threat model nobody checked against
  the implementation is a document, not a control.

### 2.5 Accessibility and visual

- Keyboard navigation through every dialog; focus trapped and restored.
- Contrast checked in both themes, especially the status badge palette
  (`docs/ui-guide.md` §10) — amber on a light background is the usual failure.
- Every icon-only button has an accessible name.
- Playwright visual snapshots for all routes × three roles × two themes, committed as the new
  baseline replacing `proto-v1`.

---

## 3. Steps — operability

### 3.1 The admin ops page

`app/(app)/ops/`, admin-only, extending Build 06's failed-jobs list:

- **Jobs**: failed rows with `last_error` and a Retry button; recent run history; queue depth.
- **Backup status**: when the last object landed in `apex-backups`, and its size. This is the
  P1 control's dashboard and it should be the first thing on the page.
- **Inventory drift**: the last reconcile result.
- **Orphans**: `auth.users` rows with no `profiles` row (Build 03 §2.10), and `attachments` rows
  whose R2 object is missing.
- **Business telemetry** (`architecture.md` §9.1) — on the Admin dashboard, not buried in ops,
  because for this system operational health and product value are the same thing:
  approvals pending > 7 days · stock requests pending > 3 days · bills submitted and uncertified
  > 14 days · outstanding receivables, aged · inventory items Critical.

### 3.2 Audit log UI

`app/(app)/users/audit/`, admin-only (`01-hld.md` §14). Filter by actor, entity type, entity id
and date range; paginated; showing the before/after JSON diff readably.

For a system where the client's sign-off is the commercial record, *"who marked this Delivered,
and when"* must be answerable years later. Test that specific question against seeded data.

Partition `audit_log` by month once it passes ~5M rows (`02-lld.md` §3.9) — write the migration
now, apply it when the row count justifies it, and note the trigger threshold in the runbook.

### 3.3 Runbooks

Write all nine from `architecture.md` §13 into `docs/runbooks/`. Each is a numbered procedure
someone can follow at 2 a.m. with no context:

`restore-database.md` · `backup-failed.md` · `inventory-drift.md` · `bill-number-gap.md` ·
`role-change-not-taking-effect.md` · `supabase-paused.md` · `r2-outage.md` ·
`rotate-secrets.md` · `restore-drill.md`

**Then execute three of them for real** and correct what the execution reveals:
`restore-database.md`, `backup-failed.md` and `rotate-secrets.md`. An unrehearsed runbook is a
guess written down.

### 3.4 The restore drill

`architecture.md` §7.2, done properly and timed:

1. Pull the latest dump from `apex-backups`.
2. Restore into a scratch Supabase project.
3. Run the pgTAP suite against the restored database.
4. Spot-check the most recent bill's arithmetic against its stored figures.
5. **Record the elapsed time.** The RTO target is 4 hours; if the drill takes six, either the
   target or the process is wrong.
6. Delete the scratch project.

Write the result into `docs/runbooks/restore-drill.md` with the date and the elapsed time.
An unverified backup is a belief, not a control.

### 3.5 Alerts, wired and tested

Every row of `architecture.md` §9.2, implemented and **fired once deliberately** to confirm the
channel works:

| Alert | Condition | Severity |
|---|---|---|
| Site down | `/api/health` failing 3× | P1 |
| Nightly backup failed | Job failed **or no object written by 02:00 IST** | **P1** |
| Error rate spike | > 10 errors / 5 min | P2 |
| Inventory drift | Reconcile finds cache ≠ ledger | P2 |
| Job failed permanently | Any `jobs` row reaches `failed` | P2 |
| DB usage > 80% of tier | Supabase metric | P3 |
| R2 storage > 8 GB | Approaching free allowance | P3 |
| Slow query > 2 s | `pg_stat_statements` weekly digest | P3 |

The backup alert asserts **an object exists**, not that a handler returned success (Build 06
§3.6). Test it by deliberately breaking the backup credentials for one night in preview.

### 3.6 Error budget policy

Write `architecture.md` §8.1's policy into `docs/`: if the availability SLO is breached over a
rolling 30 days, the next sprint prioritises reliability over features. Stated up front so it is
not argued about later.

### 3.7 DPDP deletion path

Implement deletion-on-request as `architecture.md` §12 specifies: **anonymise the profile —
clear name, email and phone — while preserving the audit trail**, which keeps the actor id. Never
hard-delete a profile: `audit_log`, `bill_events` and `stock_movements` all reference it, and
`AGENTS.md` requires soft delete throughout.

An owner-only action, audit-logged, with a confirmation that names exactly what will be erased
and what will be kept.

---

## 4. Steps — cutover

### 4.1 Data migration

1. Write `scripts/import/` — a one-shot, idempotent, **dry-runnable** importer reading the signed-off
   spreadsheet (§0.3) and producing SQL or calling the actions. Not a notebook, not a paste into
   the SQL editor: a script that can be run twice with the same result and reviewed before it runs.
2. Order: org → clients → profiles and invitations → projects → packages → phases → tasks →
   project members → opening inventory as `adjust` movements with the reason
   `"opening balance, migrated <date>"`.
3. **Validate after import**, automatically: every project has a unique code; package
   allocated/internal totals match the spreadsheet to the rupee; every site user has the memberships
   they should; `next_bill_seq` is correct per project (D22); inventory quantities reconcile to
   the ledger.
4. Run it against a **restored copy of production** first, then production.
5. Print a reconciliation report and have Voola sign it off before anyone logs in.

### 4.2 Cutover checklist

Run in order on the go-live date:

- [ ] All CI green on `main`; `pnpm build` clean
- [ ] Every environment variable set in Vercel Production, verified by a startup check
- [ ] Custom access token hook registered on **`apex-prod`** (Build 03 §0.1 — it is per-project
      and it is the single most commonly forgotten step)
- [ ] Public sign-up disabled on `apex-prod`. Verify by request, not by looking at the toggle
- [ ] Migrations applied to `apex-prod`; `pnpm db:check-drift` clean
- [ ] **Seed data is NOT in production.** Verify: no `BHEL Nagnar Club House` demo rows unless it
      is a real project, no demo profiles
- [ ] Data migration run and reconciliation signed off
- [ ] `BILLING_ENABLED` flipped on **only after** the CA sign-off is on file
- [ ] Cron entries live; `jobs.drain` observed running each minute in the Vercel log
- [ ] **A real backup object exists in `apex-backups`**, verified by listing the bucket
- [ ] Uptime monitor green; alerts tested down every channel
- [ ] Smoke test as all three roles on the production domain, on a phone and a desktop
- [ ] Invitations sent; every user has signed in successfully at least once
- [ ] Rollback plan confirmed: Vercel instant rollback for code, **and the explicit
      acknowledgement that schema does not roll back** (`architecture.md` §10.2) — which is why
      every migration since Build 02 has been forward-only and backward-compatible

### 4.3 The first week

- Daily: check the ops page, the failed-jobs list and the backup status.
- Watch the Vercel logs for anything unmapped reaching a user (grep the `[action] unmapped
  error` lines — D49 removed the error-tracking service that used to aggregate these).
- Confirm the first real stock request, the first real approval and the first real bill each go
  end to end, with someone watching.
- **Do not ship features in week one.** Fix what the real users hit.

### 4.4 Final documentation pass

Every design document must now describe what was actually built, not what was planned:

- `01-hld.md` §8.4 — the CA's answers, replacing the open questions
- `01-hld.md` §18 and `architecture.md` §16 — every decision closed, with its answer
- `architecture.md` §7.2 — the real backup mechanism (D17), the measured RTO from the drill
- `architecture.md` §15 — new ADRs for D11 (data access), D14 (column isolation), D17 (backup)
- `02-lld.md` — any schema that diverged, plus `searchAll`
- `AGENTS.md` — final, matching the shipped repository
- `docs/ui-guide.md` — the date picker, the corrected bill summary, the auth screens
- `docs/decisions.md` — no `PENDING` rows left
- `docs/progress-tracker.md` — all ten builds complete

A design document that has drifted from the code is worse than none: it makes a future
maintainer confidently wrong.

---

## 5. Verification — exit criteria

```bash
pnpm typecheck && pnpm lint && pnpm test --coverage && pnpm test:rls && pnpm test:e2e && pnpm build
pnpm audit --audit-level=high
curl https://app.beapex.in/api/health
```

- [ ] RLS coverage report: no untested table × role cell.
- [ ] All 25 tests from `02-lld.md` §12 present, passing, none skipped.
- [ ] P95 dashboard < 1.5 s and P95 mutation < 500 ms against the production-shaped dataset.
- [ ] CSP enforced with no violations in a full journey through all three roles.
- [ ] The restore drill completed, timed, and within the 4-hour RTO.
- [ ] Every §3.5 alert fired once and received.
- [ ] Three runbooks executed for real and corrected.
- [ ] Data migration reconciliation signed off by Voola.
- [ ] The cutover checklist complete, every box ticked by a person.
- [ ] Every design document updated; `docs/decisions.md` has no `PENDING` rows.

---

## 6. Guardrails — do not

- **Do not go live without a verified backup object** in `apex-backups`. Not a green job — an
  object you listed with your own eyes.
- **Do not go live with `BILLING_ENABLED` on** before the CA sign-off is on file.
- **Do not load demo data into production.**
- **Do not disable or skip a test to get the release out.** Especially not an RLS test.
- **Do not run the data migration directly against production first.** Restored copy, then
  production.
- **Do not treat a code rollback as a schema rollback.** There is no schema rollback.
- **Do not ship new features in week one.**
- **Do not leave a design document describing a system that was not built.**

---

## 7. Deliverables

- [ ] Complete RLS matrix with a coverage report that fails on a gap
- [ ] All 25 tests from `02-lld.md` §12, none skippable
- [ ] Performance pass documented, with before/after `explain` output
- [ ] CSP, HSTS, rate limiting, audit clean, redaction test, security review, threat model verified
- [ ] Accessibility pass; new visual baseline
- [ ] Ops page, audit log UI, business telemetry on the admin dashboard
- [ ] Nine runbooks, three of them rehearsed
- [ ] Restore drill executed, timed and recorded
- [ ] Every alert wired and test-fired
- [ ] DPDP anonymisation path
- [ ] Idempotent, dry-runnable data importer with automated reconciliation
- [ ] Cutover checklist executed; production live on `app.beapex.in`
- [ ] Every design document reconciled with the shipped system
