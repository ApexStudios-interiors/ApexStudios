# Decision Register

Every decision that blocks or shapes schema, security or scope. One entry each.

Sources: `01-hld.md` §18 (D1–D10), `architecture.md` §15–16 (ADR-016, A-4, A-5, A-6), and
`build/01-foundations.md` §0.1 (D11–D13, which surfaced while reading the code), plus D14, which
surfaced while executing Build 01.

**A recommendation is an argument, not an answer.** Only an entry with a named person and a date
under `**Answered:**` is a decision. Any build file that reaches a `PENDING` decision it depends on
must stop and ask.

---

### D1 — Client portal, or internal-only?

**Question:** The earlier Apex spec said "internal use only, no client portal". The UI has a full
Client role with bill certification. Which is right?
**Answered:** 2026-09-09 by Voola
**Answer:** The Client role stays. The UI is right.
**Consequence:** `app_role` includes `client`. External-user onboarding (magic link / phone OTP,
`01-hld.md` §6) is in scope. Client-facing RLS and the column-omitting `v_*_client` views are
core, not optional. Client sign-off is the product's differentiator.

---

### D2 — Simple inventory, or warehouses / GRN / weighted-average costing now?

**Question:** The earlier spec had warehouses, GRNs, purchase orders and WAC costing. This UI has a
much simpler inventory. Is the simple model the target, or is this Phase 1 of the bigger one?
**Answered:** 2026-09-09 by Voola
**Answer:** Simple model for v1. Keep the append-only movement ledger so WAC is additive later.
**Consequence:** `stock_movements` carries no cost layers in v1, but every quantity change goes
through it so cost layers can be derived retrospectively. Warehouses, GRNs and purchase orders stay
in `01-hld.md` §2.3 (deferred but designed-for). See ADR-003.

---

### D3 — One organisation forever, or resold to other contractors?

**Question:** Is this one organisation (Apex Studios) forever, or will it be resold to other
contractors?
**Answered:** 2026-09-09 by Voola
**Answer:** Single organisation for now, but `org_id` on every table from day one.
**Consequence:** Every business table carries `org_id` (`02-lld.md` §1.3). The `auth_org()` helper
and the JWT `org_id` claim exist from the first migration. Multi-tenant isolation is cheap now and
expensive to retrofit. If reselling later becomes real, the threat model and backup strategy get
revisited then (`architecture.md` §16 item 2).

---

### D4 — Material-at-site: secured advance or sale of goods?

**Question:** Is material-at-site billing a secured advance (recovered when the material is
consumed) or a sale of goods?
**Answered:** 2026-09-09 by Voola
**Answer:** Secured advance. **Pending CA confirmation.**
**Consequence:** Matches the 75% `mas_billable_pct` default and the recovery concept already in the
UI. The MAS recovery line (`01-hld.md` §8.4 step D) prevents double-billing when the material is
later embedded in a billed phase. The GST treatment differs between the two readings, so Build 09
must not issue a real bill until the CA confirms. See ADR-005 and `01-hld.md` §8.4 question 3.
**Open:** CA confirmation. Blocks the first real bill, not Build 09's implementation.

---

### D5 — Does the platform compute TDS?

**Question:** Should the platform compute TDS (194C) deductions on bills, or leave that to the
client's accounts team?
**Answered:** 2026-09-09 by Voola
**Answer:** Informational line only. Not tracked as a liability.
**Consequence:** `tds_pct` is a per-project column and TDS appears as a deduction line in the
`net_payable` arithmetic (`01-hld.md` §8.4 step I). There is no TDS ledger, no challan tracking and
no 26AS reconciliation. Reporting stays with the client's accounts team.

---

### D6 — Bills per-project or per-package?

**Question:** Are RA bills raised per-project or per-package? The UI's Bills table has a "Packages"
column implying a bill can span packages.
**Answered:** 2026-09-09 by Voola
**Answer:** Per-project, spanning packages, numbered `RA-{project_code}-{n}`.
**Consequence:** `bills.project_id` is the parent; `bill_lines` reference phases and stock
movements across any package in that project. Numbering is gapless and sequential per project
(`architecture.md` §12). Cumulative arithmetic sums prior bills on the same project.

---

### D7 — Mobilisation advance tracking needed?

**Question:** Do you need mobilisation advance tracking?
**Answered:** 2026-09-09 by Voola
**Answer:** Yes. Track the advance, its recoveries, and the running balance.
**Consequence:** This is firmer than the build file's conditional recommendation and it widens
Build 09. A mobilisation-advance recovery ledger is required: the advance amount, a recovery
schedule, per-bill recovery rows and a running balance. `01-hld.md` §8.4 step J
(`less: mobilisation advance recovery`) is now a real line, not a placeholder. Build 09 must not
treat it as optional.

---

### D8 — Is there an `owner` above the four admins?

**Question:** Who is the Admin of Apex — is there a Super Admin above the four named staff who
alone manages users and billing constants?
**Answered:** 2026-09-09 by Voola
**Answer:** Yes. Add `owner` above `admin`.
**Consequence:** `app_role` enum includes `owner`. Role assignment and edits to billing constants
(`gst_rate_pct`, `retention_pct`, `mas_billable_pct`, `tds_pct`) are owner-only. `owner` inherits
every `admin` read. `owner` still gets no update or delete on `audit_log`, `stock_movements` or
`bill_events` — append-only means append-only (ADR-007). See `02-lld.md` §2.

---

### D9 — Can one client have several projects?

**Question:** Does a client ever have more than one project with you?
**Answered:** 2026-09-09 by Voola
**Answer:** Yes. Design for it.
**Consequence:** Client portal navigation lists projects rather than assuming one. Project
membership is a join table, not a column on the profile. The All Projects page is role-scoped, not
admin-only.

---

### D10 — Accept Supabase preview branches per PR?

**Question:** Staging was excluded in the earlier spec. Do you accept a Supabase preview branch per
pull request?
**Answered:** 2026-09-09 by Voola
**Answer:** Yes.
**Consequence:** Revises the earlier "no staging environment" decision (ADR-009). Each PR gets a
real Postgres with migrations applied and seed data, torn down on merge. No long-lived staging tier
to maintain. Production schema changes only ever arrive through a merged, CI-verified migration.
CI gains an ephemeral-database stage in Build 02.

---

### D11 — Does application data access go through Drizzle or the Supabase client?

**Question:** `architecture.md` §4 showed `service.ts → lib/db (Drizzle)` for application queries.
A Drizzle connection over `postgres-js` / `DATABASE_URL` authenticates as a privileged database
role and **bypasses Row Level Security completely** — every policy in `02-lld.md` §6 would become
decorative, and the promise that a client cannot see `internal_amount` would rest on nothing but
application code being correct.
**Answered:** 2026-09-09 by Voola
**Answer:** Resolution (A). User-context data access goes through the Supabase client with RLS.
Sensitive writes go through Postgres RPC / `security definer` functions.
**Consequence:** This is a hard rule, not a preference:

- All user-facing reads, writes and `rpc_*` calls go through the Supabase server client bound to
  the user's JWT via `@supabase/ssr`. PostgREST runs the query as `authenticated` with the user's
  claims, so RLS applies automatically.
- Money and stock mutations go through `security definer` RPCs that take row locks (ADR-012),
  never application-level read-modify-write.
- Drizzle is kept for schema definition, migration generation, generated types, and queries inside
  `lib/jobs/handlers/**` that legitimately run as `service_role`.
- **A Drizzle query in a request path is an RLS bypass and a blocking review comment.** An ESLint
  rule restricts `drizzle-orm` imports to `db/**` and `lib/jobs/handlers/**`.

Written into `../AGENTS.md` and `architecture.md` §4 in the Build 01 PR, because both documents
previously implied the unsafe option.

---

### D12 — Package manager and stack version drift

**Question:** The docs describe pnpm and Next.js 15; the repo was npm and Next.js 16.3.4.
**Answered:** 2026-09-09 by Voola
**Answer:** pnpm. Pin the Node and toolchain versions. Commit the lockfile.
**Consequence:** `package-lock.json` replaced by `pnpm-lock.yaml`; `packageManager` and
`engines: { node: ">=20" }` in `package.json`; `.npmrc` with `engine-strict=true`; CI installs
with `--frozen-lockfile`. Next.js stays on 16 and the documents are corrected to match. React 19
and Tailwind v4 stay. The hand-rolled `components/ui/` primitives stay — **shadcn/ui is not
introduced.** The UI is complete and is the functional specification.

---

### D13 — Repository layout: `src/` or root?

**Question:** `../AGENTS.md` showed a `src/`-rooted tree. `02-lld.md` §8.1, `code-standards.md` §1
and the actual repository are all root-rooted.
**Answered:** 2026-09-09 by Voola
**Answer:** Root layout. Not `src/`.
**Consequence:** `app/`, `components/`, `features/`, `lib/`, `db/` at the repository root. Moving
to `src/` would churn every import for zero value. `../AGENTS.md` amended in the Build 01 PR; the
other documents already assumed root.

---

### D14 — Is Docker part of the toolchain?

**Question:** The local Supabase stack (`supabase start`) runs Postgres, GoTrue and PostgREST in
Docker containers. That is where migrations, seed data and the pgTAP policy suite were going to
run. Is Docker an acceptable dependency?
**Answered:** 2026-09-09 by Voola
**Answer:** No. **No Docker anywhere** — not on a developer machine, not in CI.
**Consequence:** The local Supabase stack is out entirely.

- **Development** runs against a hosted Supabase project, `apex-dev`, in ap-south-1. There is no
  local database. Every query is a network round trip to Mumbai, which is the cost of the
  decision and is worth knowing before Build 04 starts adding queries per page.
- **Migrations** are applied with `supabase db push` against a linked project, over a connection
  string. `supabase/migrations/*.sql` remains the source of truth (`../AGENTS.md` database rule 1)
  and nothing is ever changed through the dashboard.
- **Pull requests** get a Supabase preview branch (D10), which is a real Postgres with the
  migrations and seed applied. That is where the pgTAP suite runs in CI, against a connection
  string rather than a local container.
- **`supabase start`, `supabase stop` and `supabase db reset` are not used.** `pnpm db:reset` now
  resets the linked non-production project, which is destructive and refuses to touch production.
- `supabase/config.toml` is kept: it is also the source for `supabase config push`, which is how
  `jwt_expiry` and `enable_signup` reach the hosted projects.

**What this costs.** Two things get harder and should not be discovered later:

1. **Seed data is shared.** With no per-developer database, `apex-dev` is one dataset that
   everyone edits. Destructive experiments belong on a preview branch, not on `apex-dev`.
2. **Offline development stops working.** No network, no database.

**What it does not cost.** The rule in `02-lld.md` §6.3 — test RLS from a client SDK session,
never the SQL editor — is unaffected and arguably better served, because the policies now run on
real Supabase infrastructure rather than a local approximation.

Supersedes the "Local" row in `architecture.md` §5.2 and `01-hld.md` §13, and the Docker
prerequisites in `build/01-foundations.md` §0.4 and `build/02-database.md`.

---

### ADR-016 — Vercel Pro and Supabase Pro at go-live?

**Question:** Free tier or paid tier at launch?
**Answered:** 2026-09-09 by Voola
**Answer:** Yes. Vercel Pro and Supabase Pro from day one. ~₹4,000/month.
**Consequence:** Moves ADR-016 from Proposed to Accepted. Supabase Pro gives point-in-time
recovery, which takes RPO from 24 hours to 15 minutes (`architecture.md` §7.2), and stops the
project pausing after seven days idle. Vercel Pro is required for the per-minute `jobs.drain` cron
in Build 06, and the Hobby tier forbids commercial use — this system issues tax invoices.

---

### A-4 — Antivirus scanning of uploads?

**Question:** Uploads are excluded from antivirus scanning in v1. Site photos arrive from
supervisors' personal phones. Is that acceptable?
**Answered:** 2026-09-09 by Voola
**Answer:** Out of scope for v1. Confirmed explicitly.
**Consequence:** No scanning step in the upload path. Mitigations that remain: a single private R2
bucket, presigned URLs only, no public bucket (ADR-008), and content-type plus size limits at
presign time. Revisit if uploads ever become reachable by anyone outside the org.

---

### A-5 — Statutory retention period for archived projects

**Question:** Retention is currently indefinite. What is the exact statutory figure, so the R2
lifecycle rules can be written?
**Answered:** 2026-09-09 by Voola
**Answer:** **Pending CA confirmation** of the exact statutory retention period.
**Consequence:** Until confirmed, retention stays indefinite and nothing is lifecycled out of R2.
Archived projects still move to `status='archived'` and drop out of default lists. Blocks the R2
lifecycle rules in Build 10, not the archiving itself. Note that the GST period is measured from
the annual return date, not the invoice date.
**Open:** CA confirmation. Blocks Build 10's lifecycle rules.

---

### A-6 — Client prompting with no email in v1

**Question:** With notification in-app only, a Client has no external nudge for a pending approval
or an uncertified bill. Confirm phone-chasing, or scope WhatsApp/SMS instead.
**Answered:** 2026-09-09 by Voola
**Answer:** Phone and manual prompting in v1. WhatsApp/SMS automation is deferred.
**Consequence:** Confirms ADR-017 — email notification stays out of scope for v1 and the
notification bell reads live from a database view (ADR-014). No notification table, no read state,
no outbound channel. Transactional email is still needed for client magic-link logins in Build 03;
that is authentication, not notification.

---

### D15 — Does a definer view read through `force row level security`?

> **Numbering note.** `build/02-database.md` §2 says to record this as D14. D14
> was already taken by the Docker decision during Build 01, so the spike is D15.
> The build file has been amended to match.

**Question:** `02-lld.md` §6 requires `alter table … force row level security` on
every table, and §4.3 implements column isolation as `security definer` views
(`security_invoker = off`) reading those same tables. `force` makes RLS apply to
the table's **owner** as well, and a definer view executes as the view's owner.
If the owner is subject to the base table's admin-only policy, then
`v_package_client` — which must return rows to a *client* session — is evaluated
against `packages_select_admin` (`using (is_admin())`) and returns **zero rows**.
The client's Packages table would render silently empty. Nothing would error.
**Answered:** PENDING — the spike cannot run without a database
**Answer:** Not yet known.
**Consequence:** This gates migration 0014 and the whole column-isolation design.
The migrations are written as though the answer is yes, because that is what
`02-lld.md` §4.3 specifies, and because nothing is applied yet an unapplied
migration can be edited freely if the answer turns out to be no.

Run it with `pnpm spike:d15` the moment `apex-dev` exists. It creates a
throwaway table, a throwaway client user and a real signed-in session, asks the
two questions, and tears everything down. It refuses to run against production.

Three possible outcomes:

- **PASS** — the view returns rows and the base table stays closed. Proceed
  exactly as `02-lld.md` §4.3 specifies. Nothing changes.
- **FAIL** — the view returns nothing. Pick one of these, write it into
  `02-lld.md` §4.3, and say so in the PR:
  1. Grant the view owner `bypassrls`, or own the views with a role that has it.
     Smallest change; no migration edits to the tables.
  2. Drop `force row level security` on the six cost-bearing tables only
     (`packages`, `phases`, `bills`, `bill_lines`, `inventory_items`,
     `stock_requests`), keeping it everywhere else. What that gives up: RLS stops
     applying to the table owner, which matters only for a direct owner-role
     connection — and under D11 the application never opens one.
  3. Replace definer views with column-level `GRANT`s, which makes
     `select internal_amount` a hard permission error rather than an empty
     result. Its limitation is that grants are per database role and every app
     user shares `authenticated`, so it cannot tell client from site; views would
     still be needed on top for that.
- **LEAK** — the base table returns rows to a client session. Stop everything.
  The admin-only policy is not being applied at all, and nothing else matters
  until that is understood.

**Blocks:** trusting migration 0014, and therefore every non-admin surface in
Builds 04–09.

---

## Still open

| Item | Owner | Blocks | Raised |
|---|---|---|---|
| **D15 spike — definer views under `force row level security`.** Cannot run without a database. Gates migration 0014 and every non-admin surface. | Claude, on `apex-dev` | Builds 04–09 | 2026-09-09 |
| CA confirmation: material-at-site as secured advance (D4) | Voola → CA | First real bill | 2026-09-09 |
| CA confirmation: statutory retention period (A-5) | Voola → CA | Build 10 R2 lifecycle rules | 2026-09-09 |
| CA sign-off: the five tax questions in `01-hld.md` §8.4 | Voola → CA | Build 09 go-live | 2026-09-09 |
| DPDP Act 2023 obligation set (`architecture.md` §12) | Voola → counsel | Launch | 2026-09-09 |
