# Decision Register

Every decision that blocks or shapes schema, security or scope. One entry each.

Sources: `01-hld.md` §18 (D1–D10), `architecture.md` §15–16 (ADR-016, A-4, A-5, A-6), and
`build/01-foundations.md` §0.1 (D11–D13, which surfaced while reading the code), plus D14–D17,
which surfaced while executing Builds 01 and 02.

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
**Answered:** 2026-09-10, by running `pnpm spike:d15` against `apex-dev`
**Answer:** **PASS.** A definer view reads through `force row level security`
while the base table stays closed to the same session:
`v_spike_client` returned the row, `spike_costs` returned none.
**Consequence:** Migration 0014 needs no design change. Proceed exactly as
`02-lld.md` §4.3 specifies — the role-scoped views are trustworthy as written.

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

### D16 — Project code convention

**Question:** `projects.code` is unique per org and is embedded in every bill
number forever (D6, `RA-{code}-{n}`). What format, what maximum length, and who
assigns it?
**Answered:** 2026-09-10 by Voola
**Answer:** `BHEL-NCH`. Upper-case alphanumeric groups separated by single
hyphens.
**Consequence:** Enforced by `projects_code_ck` in migration 0004:
`code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' and length(code) between 3 and 20`. A check
constraint rather than a hopeful comment, because a typo at project creation is
permanent — it is already in the bill numbers by the time anyone notices. Twenty
characters keeps `RA-{code}-{n}` inside a bill-header column.
**Still loose:** who assigns a code was not specified. Currently any admin can,
since project creation is an admin action. Tighten to owner-only if that turns
out to matter.

---

### D17 — Inventory unit vocabulary

**Question:** What are the real units Apex works in? Needed for seed realism and
for the Build 07 unit dropdown.
**Answered:** 2026-09-10 by Voola
**Answer:** `bag`, `sft`, `kit`, `len`, `can`, `sqm`, `rft`, `nos`, `set`.
**Consequence:** A closed list, so it became a `units(code, label, sort_order)`
lookup table in migration 0006 rather than staying free text.
`inventory_items.unit` and `stock_requests.unit` both reference it; the column
type is unchanged, it just gained a foreign key.

This deviates from `02-lld.md` §3.4, which had `unit text` with the codes in a
comment, and that document is amended in the same PR. The reason: free text over
a closed vocabulary lets `bag` and `bags` become two materials that never
reconcile, in a table whose quantity feeds a bill. Build 07's dropdown now reads
the table instead of duplicating the list in TypeScript and drifting from it.

Adding a unit later is a migration inserting a row, never a dashboard edit.

---

### D18 — Supabase project region

**Finding, not a question anyone was asked.** `architecture.md` §5.1 requires
`apex-dev`/`apex-prod` in `ap-south-1` (Mumbai), co-located with Vercel's `bom1`
for latency. The `apex-dev` project actually created resolves to the
**ap-northeast-1 (Tokyo)** pooler, discovered while diagnosing a connection
failure, not by inspecting the region at creation time.
**Status:** Unresolved. Not blocking Build 02 — schema work does not depend on
latency — but every query from a Mumbai-region Vercel deployment to a
Tokyo-region database pays the cross-region round trip `architecture.md` §5.1
specifically warns against (~200ms estimated per query when mismatched).
**Recommendation:** recreate `apex-dev` in `ap-south-1` before Build 04 starts
adding the queries that would actually feel this, and pick the region
explicitly and confirm it at creation for `apex-prod` — the picker does not
default to Mumbai.

---

### D19 — Phone OTP for client sign-in: v1 or deferred?

**Question:** `01-hld.md` §6 offers clients magic link **or** phone OTP. Phone OTP needs a paid
SMS provider, an Indian DLT sender-ID registration, and template approval — a multi-week
regulatory process, not a configuration step.
**Answered:** 2026-09-10 by Voola
**Answer:** Magic link only for v1. Phone OTP deferred; DLT registration not started.
**Consequence:** `app/(auth)/client-login/page.tsx` offers email magic link only. No SMS
provider, no DLT registration, no phone-number column treated as a sign-in credential in
Build 03. Revisit if a client without email access becomes a real blocker.

---

### D20 — Admin "preview as" impersonation: build it now?

**Question:** `01-hld.md` §3.1 specifies a read-only, audit-logged, banner-flagged capability
for owner/admin to see what a client or site supervisor sees.
**Answered:** 2026-09-10 by Voola
**Answer:** Yes, build it in Build 03.
**Consequence:** A signed, short-lived (15-minute) httpOnly cookie shapes reads for the
previewed role and project. Every write path still checks the **real** session and refuses —
enforced in the RPCs and tested directly, not just hidden in the UI. `fn_audit` records start
and stop. The banner is persistent and not dismissible while active.

---

### D21 — Findings from Build 04 (Projects/Packages/Phases)

Three things discovered while building the first real-data queries, none blocking this build but
each worth a future build not rediscovering the hard way.

**PostgREST serializes `numeric` and `int8` as JSON numbers, not strings.** `scripts/gen-types.mjs`
assumed both are always strings, copying `postgres.js`'s own driver behaviour (used elsewhere in
this codebase, e.g. Drizzle and Node scripts, which really does return them as text). Verified live
against `v_package_rollup` and `v_package_site`'s count columns: both come back as plain numbers
over PostgREST. Fixed in the generator with a comment; not a precision risk for this schema —
`numeric(14,2)`'s largest value and every `int8` here (row counts, sequence values) are well inside
a double's exact-integer range.

**`v_phase_client` and `v_phase_site` returned zero rows for every non-admin session, always** —
found live, not by a test, while wiring the Budget/Phases tab. Both joined `v_phase_billing` for
`is_complete`; `v_phase_billing` is deliberately `security_invoker = on` (0013's own comment: so its
own admin-only policy applies to a *direct* query), but that means the join re-evaluates RLS as the
original caller when reached through another (definer) view — a client or site session has no
`SELECT` on `phases`/`tasks` at all, so the join always contributed zero rows regardless of the
outer view's own `is_member_of()` filter. Fixed by computing `is_complete` inline against `tasks`
in both views, the same pattern `v_package_site` already used for its own counts. This had shipped
in Build 02 and gone uncaught because nothing queried it until this build.

**Any soft delete through the Supabase client will fail RLS on a table whose `SELECT` policy
filters `deleted_at is null`** — which is nearly every table (`code-standards.md`'s soft-delete
rule). Postgres enforces the table's `SELECT` policy against the post-write row whenever `RETURNING`
is used, and PostgREST always executes `UPDATE ... RETURNING`, so a plain
`.update({ deleted_at: now() })` gets `42501: new row violates row-level security policy`, even with
`Prefer: return=minimal`. Confirmed live against `packages`. No build has shipped a soft-delete
action yet, so nothing depends on this today, but the first one that does (removing a project
member, cancelling a stock request, Build 10's retention purge) needs either a `security definer`
RPC for the delete itself, or a policy restructure — not a plain client-side `.update()`.

### D22 — Findings from Build 04's admin Playwright journey

The admin create/edit journey (build/04-projects-packages-phases.md §5) was the first thing in
this codebase to actually create a project through the UI and immediately read it back. Every one
of these was invisible until that happened.

**Every Supabase client read was silently eligible for Next.js's fetch cache.** A project created
by a Server Action, then read on the very next request (the redirect to its own dashboard), came
back as "not found" — reproducible only inside Next.js, not against Postgres or PostgREST
directly (verified with a standalone script: create-then-immediate-read worked every time outside
the app). Next's App Router patches the global `fetch` to add its own Data Cache, defaulting to
`force-cache` for a fetch made during rendering; `@supabase/ssr`'s client uses that same ambient
`fetch` with no override. `lib/supabase/server.ts` now passes `global: { fetch: (input, init) =>
fetch(input, { ...init, cache: "no-store" }) }` — every request through this client is per-session
and RLS-scoped, and had no business being cached across requests regardless of this specific bug.
**This could have been silently affecting every read in the app since Build 03**; it only surfaced
now because nothing before this build did a write-then-immediate-read within one running server
process in a test.

**`app/(app)/projects/[projectId]/layout.tsx` never got the real access check Build 03 promised
it.** Its own deviation note said `requireProjectAccess` was deferred until project ids became
real (this build). It's wired in now. `ProjectShell.tsx`'s client-side `exists` check — against
`AppContext`'s mock `data.projects` array — is gone with it: a project created through the real
`createProject` action has no entry there and never will, so that check said "not found" for a
project that was genuinely real and genuinely accessible, and `LegacyDashboardCards.tsx`'s
`useProject()` call (which *throws* on the same mismatch) crashed the whole dashboard to the
generic error boundary. Both now treat "no mock entry" as "nothing to show," not "doesn't exist" —
the same posture `useLegacyModule` already took for package tabs.

**A native `<select>`'s "unassigned" option submits `""`, and `z.uuid().optional()` rejects it
outright** — a string that isn't a UUID, not an absent field. This failed at CLIENT-side
validation, before `AddModuleDialog`/`EditModuleDialog`'s own submit handler ever ran, so the
manual `leadProfileId: value || undefined` fallback in each dialog never got a chance to help.
`features/packages/schema.ts`'s `leadProfileId` now accepts `""` and transforms it to `undefined`
in the schema itself — the one place both the form and the action read from.

**`requireAalForRole` (lib/auth/session.ts) hard-requires AAL2 for owner/admin, unconditionally, in
every environment, and there is no enrollment UI yet** — Build 03 built the MFA *challenge* step,
for a factor that already exists, never enrollment. No seeded account had a factor, so every
`adminAction`-guarded Server Action (this build's own `createProject`, `createPackage`, and
everything after them) was unreachable by the seeded admin account. `e2e/global-setup.ts` now
enrolls and verifies a real TOTP factor for the seeded admin through `supabase-js` directly (there
is nowhere else to do it from) and persists the secret locally (`e2e/.auth/admin-totp-secret.txt`,
gitignored) so every run after the first computes a fresh code for the real `/login` challenge —
the same one a human with an authenticator app completes. **The actual enrollment UI remains
unbuilt**; a real admin account cannot pass MFA today outside this dev workaround. Recorded here
rather than in "Still open" below because build/03-auth-and-rbac.md's own scope, not Build 04's,
is where it belongs — flagging it is this build's job, building it is not.

**Superseded 2026-09-17 by D48:** the AAL2 requirement was removed rather than an enrollment UI built.

---

### D23 — Build 05 prerequisites (week convention, drag-to-reschedule, task progress authority, start dates)

**Question:** `build/05-schedule-and-progress.md` §0 raises four items before the Gantt can move
to real dates: plain weeks vs. a working-day calendar, whether drag-to-reschedule should be added,
whether Site (not just Admin) may set task progress to 100% — the action that makes a phase
billable — and whether the seeded project start dates are correct.
**Answered:** 2026-09-11 by Voola
**Answer:**
- Plain seven-day weeks, no holiday calendar, no working-day logic. A task's bar may include
  Sundays; the "late" flag ignores public holidays.
- Drag-to-reschedule stays excluded. Dates are edited through the Task Detail dialog only.
- Site keeps the authority to set task progress to 100%, matching `01-hld.md` §7.1 as already
  specified — not narrowed to Admin only.
- The seeded start dates are correct and final: BHEL Nagnar Club House 24 Aug 2026, BHEL Nagnar
  Entrance Arch 1 Sep 2026.
**Consequence:** Build 05 proceeds exactly as `02-lld.md` §3.3 and §8.3 already specify — none of
the four items changes anything already designed, they were confirmations, not redirections.
**Still open:** whether Apex has an existing schedule (MS Project or a spreadsheet) for either
project to import. None has been provided as of this build; Build 05 proceeds on the assumption
that tasks are entered by hand, and Build 10's task importer is scoped only if a real file
surfaces later.

### D24 — Finding from Build 05: a site user could never create a task

**A site role has never been able to create a task, since Build 02.** `trg_tasks_check_ancestry`
(`02-lld.md` §3.3's denormalised-ancestry guard, "the RLS shortcut becomes a lie" if it drifts)
validates a new task's `package_id`/`project_id` by reading `phases` — but `phases` is admin-only
on select (`phases_select_admin`), and the trigger function was plain `SECURITY INVOKER`. For any
caller but admin, the trigger's own lookup returned nothing under RLS and it raised
`NOT_FOUND: phase ... does not exist` for a phase that genuinely existed and that the caller was a
real member of. Found live while building `createTask` for Build 05 — `siteAction` (owner/admin/
site) is exactly the guard `02-lld.md` §7 specifies, and the very first site-role smoke test hit
this. Fixed by making the trigger `SECURITY DEFINER`: it is validating a structural invariant with
values the client does not control, not exposing `phases` data to the caller, so bypassing RLS for
this one internal check is correct, not a workaround. `supabase/tests/04_schedule_test.sql` and
`tests/integration/schedule.test.ts` both assert this directly so it cannot regress silently again.

### D25 — Two visual-baseline diffs in the Schedule Gantt, both accepted (not bugs)

Comparing the real-data `project-schedule` render against the frozen `proto-v1` screenshot
surfaced two differences. Both are pre-existing, already-documented consequences of the real
schema being stricter than the mock data, not new defects:

1. **Every task shows "To assign" instead of a name** ("Suresh K", "Sai Waterproofing", "Tiling
   gang A", "Procurement", "OEM", "Client", …). `tasks.owner_profile_id` is a real FK to
   `profiles(id)`; every one of the prototype's owner strings is an informal vendor/gang label or
   a role placeholder, none of which is a real user account. `supabase/seed.sql`'s task insert
   (Build 02) never populated `owner_profile_id` for exactly this reason — confirmed live against
   `apex-dev`: all 13 seeded tasks on the Pool package have `owner_profile_id is null`. This is the
   same "vendor name unrepresentable as a profile" finding as D21's package-lead case, applied to
   tasks. `ownerName: null` rendering as "To assign" (`features/schedule/queries.ts`'s
   `toScheduleTask`) is correct, not a bug to fix.
2. **The baseline's "General" phase group (Tile sample approval, Handover) is absent.** The
   prototype represented these two tasks with no `pkg`, i.e. not attached to any phase. The real
   schema has `tasks.phase_id not null` — there is no "General"/unassigned bucket to represent.
   `seed.sql`'s own comment (Build 02, §4.9) already documents attaching them to the phase they
   obviously belong to: "Tile sample approval" to Pool tiling, "Handover" to Testing, commissioning
   and handover. Confirmed live: both tasks exist in `apex-dev` under exactly those two real
   phases. They render inside those phases' groups instead of a separate "General" group, which is
   the correct and more accurate structure, not a missing group.

Both are called out in Build 05's PR with the actual/baseline screenshots rather than silently
updating the baseline over them.

A fourth finding, this one a real fix, not an accepted difference: every week-cell in a Gantt row
is `position: relative` (Gantt.tsx, unchanged since Build 01), so a task bar's own overflow past
its first week — `width: calc(durationWeeks*100% - 6px)`, absolutely positioned — visually
extends across later weeks' cells but sits BELOW them in paint order (same-level positioned
siblings stack by DOM order, and later weeks come later in the DOM). Two consequences, both
confirmed live via `elementFromPoint` and a real Playwright click, not a screenshot: (1) every
multi-week bar was only clickable/hoverable in its first ~one-week segment — the rest silently
swallowed the click, for every task, every role, since Build 01; (2) the "today" column's grey
highlight (`bg-muted/60`), being a later cell for any bar that starts before today's week, painted
OVER that portion of the bar, cutting a visible grey patch into it. Neither shows up in a routine
screenshot diff for a bar that doesn't span today's column, which is why it survived four builds.
Fixed by giving only the bar's own starting cell `z-10` (`components/domain/Gantt.tsx`) so it
paints above its row's later cells without changing anything else's stacking. Confirmed
`git diff main` on this file is otherwise identical to the frozen prototype's own markup — this
bug predates Build 05 and predates real dates entirely; it was simply never exercised by a click
on a multi-week bar, or caught by a screenshot of a bar spanning the then-current week, until this
build's own Playwright journeys did both.

A third, unrelated diff surfaced on `project-dashboard`, `project-packages` and `package-detail`
(all pre-existing routes, untouched by Build 05's own code): the Swimming Pool package's
"Progress" showed 16% against a frozen baseline of 14%. Verified by hand against the current,
unmodified `apex-dev` data before touching anything: `packages.progress_pct`'s trigger
(`supabase/migrations/20260909170016_triggers_rollup.sql`) computes
`round(sum(duration_weeks * progress_pct) / sum(duration_weeks))` over the package's 13 seeded
tasks — `(2×100 + 3×100) / 32 = 15.625`, which rounds to **16**, not 14. The database is correct
and the seed data is untouched since Build 02 (all 13 tasks share one `created_at`, the seed
run's own timestamp, with no leftover or orphaned rows from this build's smoke-testing). The old
baseline was simply captured against a stale value at some earlier point and never re-verified
against the trigger's own arithmetic. Refreshed to the correct, verified 16% rather than treated
as a Build 05 regression.

---

### D26 — Where `backup.nightly` actually runs (the build file calls this "D17")

`build/06-files-jobs-daily-updates.md` §3.6 names this decision "D17" — a stale reference to an
earlier draft's numbering; D17 was already claimed by the inventory unit vocabulary during
Build 02 (this file's own D17 entry, above). Recorded here as D26, the next free number, with
this note so anyone cross-referencing the build file's own text can still find it.

**Question:** `01-hld.md` §10.2 and `architecture.md` §7.2 specify a nightly `pg_dump` to R2 from
a Vercel cron route. A Vercel serverless function cannot do this: no `pg_dump` binary in the
runtime, and the function timeout is far shorter than a growing logical dump. Where should it
actually run?
**Answered:** 2026-09-12 by Voola
**Answer:** A scheduled GitHub Actions workflow (option A of the three the build file laid out).
`ubuntu-latest` has a real `pg_dump`; the workflow dumps, gzips, uploads to `apex-backups` with a
backup-scoped AWS CLI credential, then calls `POST /api/backup/report` (Bearer `CRON_SECRET`) so
the outcome still lands in the `jobs` table and the Admin ops page, the same as every other job.
**Consequence:** `backup.nightly` is absent from `vercel.json`'s crons on purpose. A second,
independent check — `/api/cron/backup.verify`, a real Vercel cron at 02:30 IST — `HeadObject`s
the expected key in `apex-backups` and lets a missing object throw; that failure landing the job
in `failed` on the Admin ops page IS the alert the build file's own requirement asks for ("assert
an object was actually written, not merely that the handler did not throw"). `architecture.md`
§7.2 and `01-hld.md` §10.2 are amended to match. **Not live-verified**: no real Cloudflare R2
account exists yet (see the "R2/Vercel not provisioned" row below) — the workflow, the route and
the job are all written and structurally correct, but no real backup object has actually been
written or checked by either piece yet.

### Build 06 prerequisites answered

**Question:** `build/06-files-jobs-daily-updates.md` §0 requires real Cloudflare R2 buckets (with
CORS), Vercel Pro, and a real `CRON_SECRET` — none of which exist (`.env.local`'s `R2_*` and
`CRON_SECRET` are Build 01's own fake-but-valid-shaped local placeholders, not real credentials).
It also asks for explicit confirmation on antivirus scanning and the daily-update edit window.
**Answered:** 2026-09-12 by Voola
**Answer:**
- R2/Vercel Pro/a real `CRON_SECRET`: not set up yet. Proceed without them — write and fully
  test everything that doesn't require live infrastructure, and flag the rest as unverified.
- A-4 (antivirus scanning) was already answered 2026-09-09: out of scope for v1, confirmed
  explicitly. Not re-litigated here; carried forward unchanged.
- The daily-update 24-hour edit window: already implemented exactly as `02-lld.md` §3.7
  specifies, in `daily_updates`' own `du_update_author` RLS policy since Build 02
  (migration 0009) — `created_at > now() - interval '24 hours'`. This build's own pgTAP suite
  asserts the literal SQL predicate so it cannot silently drift. Confirmed correct as built,
  not reopened.
**Consequence:** Every exit-criteria item needing a live bucket, Vercel Pro, or a real cron
invocation (CORS from a real browser, a thumbnail appearing within 60 seconds on a preview
deployment, the reaper firing on a killed job, a 12 MB JPEG rejected at presign, no public bucket
access, EXIF absence on a real generated thumbnail, a real backup object existing) is reported as
unverified rather than assumed — the same honest treatment Build 01 gave its own unmet §0.4 items.
See "Still open" below for exactly what unblocks each one.

### D27 — Build 06 visual-baseline findings

Comparing the converted Daily Updates surfaces against `proto-v1` surfaced two differences:

1. **Every seeded update shows no photos**, where the baseline shows 2–6 grey placeholder boxes
   per entry. `supabase/seed.sql`'s own `daily_updates` insert (Build 02) never created matching
   `attachments` rows for these four entries — there was no upload pipeline yet to create them
   with, and now that there is, there's no real R2 bucket to have actually uploaded anything to
   (this build's own prerequisites gap). Confirmed live: all four seeded updates have zero
   attachment rows. Accepted as correct given the current infrastructure, not a code bug —
   revisit once a real R2 account exists and the four originals can be backfilled with real
   photos, or leave them as the historical record they are.
2. **The package badge was missing its number prefix** ("Swimming Pool" instead of "01 Swimming
   Pool") — a real, fixable gap: the prototype's `UpdateList` always rendered `mno(project, m)`
   (lib/logic.ts's zero-padded module index) ahead of the name, and the first real version of
   `features/updates/queries.ts` dropped it. Fixed by carrying `seq_no` through
   `fetchPackageNames`/`UpdateDTO` and re-adding the same zero-padded prefix.

Separately, not a finding so much as an expected consequence: adding an admin-only "Failed Jobs"
sidebar link (build §3.7) shifts every admin-viewed screenshot by a few pixels, since the sidebar
renders on every page. All admin baselines were refreshed together for this one, deliberate reason.

---

### D28 — Stock request reference number format

**Question:** `build/07-stock-inventory-notifications.md` §0 requires a final format before the
first one is issued. The prototype uses `SR-014`; `02-lld.md`'s own schema comment shows
`SR-BHEL-NCH-014`.
**Answered:** 2026-09-12 by Voola
**Answer:** `SR-{project_code}-{n}`, one counter per project — the exact pattern D6 already
established for bill numbers (`RA-{project_code}-{n}`).
**Consequence:** `projects` gains `next_sr_seq`, incremented under the same per-project row lock
`rpc_create_bill` already takes for `next_bill_seq`. `rpc_create_stock_request` is the only path
that can allocate one — never a `count(*) + 1` in application code, which races.

### D29 — Central store and transfers, in or out for v1

**Question:** `inventory_items.project_id` is nullable, meaning `NULL` = a central store. Does
Apex actually hold central stock, and if so, are site↔store transfers needed?
**Answered:** 2026-09-12 by Voola
**Answer:** No central store for v1. Every `inventory_items` row keeps a real `project_id`.
**Consequence:** No transfer movement type, no transfer RPC — both stay out of scope, matching
`01-hld.md` §2.1's own boundary. C2 (delivery challans for warehouse→site transfers,
`01-hld.md` §8.4 item 4) stays unresolved but genuinely doesn't block anything now: it was only
ever a blocker for transfers, and there are none. Revisit both together if a central store is
ever wanted.

**Also confirmed, not re-litigated because the source documents already settle them without
ambiguity:** who marks Delivered (Admin or Site — `01-hld.md` §7.1's own permission matrix
already says so explicitly) and rate visibility (`stock_requests.rate` admin-only — same table).

### D30 — `inventory_items.unit_cost`: the build file's own wording contradicts AGENTS.md

**Finding, not a question put to Voola.** `build/07-stock-inventory-notifications.md` §2.3 says
*"`unit_cost` is admin/site, never client"* — but `AGENTS.md` names `unit_cost` explicitly, by
that exact column name, in its list of columns that must never reach a non-Admin session
("internal_amount, unit_cost, rate, internal_cost_amount or margin_amount"). AGENTS.md's own
precedence rule is that it wins over every other document, always. Both role-scoped inventory
views already agree with AGENTS.md, not the build file: `v_inventory_status` (0013, admin-only in
practice — carries `unit_cost`/`stock_value`) and `v_inventory_site` (0014, its own comment: "A
supervisor needs to know that cement is low, not what it cost"). Read as "the column exists in
the admin/site inventory *feature area*, but is never actually exposed to Site" — `unit_cost` is
implemented admin-only throughout `features/inventory/`, per AGENTS.md and per the views that
already existed before this build started.

### D31 — What does `movement_direction`'s 'adjust' value actually mean?

**Finding, resolved while writing `rpc_adjust_inventory`.** `stock_movements.qty` must be positive
(`movements_qty_ck`), and `direction` is the only column that could carry a correction's sign.
The build file's own reconcile formula — "recompute the quantity from `stock_movements`: Σ in −
Σ out ± adjust" — reads as if `adjust` were a third, separately-summed bucket, but nothing in the
table lets a third bucket's own rows carry a sign independent of `direction` itself.
**Resolved:** an adjustment is recorded as an ordinary `'in'` or `'out'` movement — whichever sign
the correction actually is — tagged `ref_type = 'adjustment'` to distinguish it from a
stock-request-driven movement. `direction`'s `'adjust'` enum value (migration 0006) is left
defined but unused by any application code; removing an already-applied enum value isn't
worthwhile for a value nothing else depends on. **Consequence:** `inventory.reconcile`'s recompute
is one formula, `Σ in − Σ out` grouped by `inventory_item_id`, with nothing structurally different
about a correction row — simpler, and loses no information the build file's own formula needed
either.

### D32 — Seeded inventory had no ledger behind it

**Finding, resolved live before writing `inventory.reconcile`.** All eight of Build 02's seeded
`inventory_items` carry a `qty_on_hand` inserted directly; zero `stock_movements` rows existed for
any of them, and none of the three seeded "delivered" `stock_requests` had `inventory_item_id`
linked. Confirmed live against `apex-dev`. Build 07's own reconcile job recomputes `qty_on_hand`
from `Σ in − Σ out` and alerts on any disagreement (D31) — with no ledger behind the seed, it
would have alerted on all eight items the first time it ever ran, which is noise, not a finding.
**Fixed in `supabase/seed.sql`** (amending Build 02's file, not this build's own migrations): the
three delivered requests now link `inventory_item_id`; one `'in'`/`ref_type='adjustment'` opening
movement per item, sized to match its own seeded `qty_on_hand` exactly, stands in for whatever
real delivery-then-consumption history was never specified — the same thing a real opening-balance
migration would write (build §0's own phrase for it), just applied to the dev seed too. Verified
live: ledger and cache now agree exactly for all eight items.

### D33 — `v_notifications`'s `bill_submitted` branch returned zero rows for Client, silently

**Finding, resolved while wiring the live notifications bell.** Migration 0015's `v_notifications`
is `security_invoker = on`, on the stated assumption that "each branch reads a table whose own
policy already scopes it correctly." That is false for `public.bills`: its only select policy,
`bills_select_admin` (0010), requires `is_admin()` — there is no policy granting a Client select on
the base table at all. Client-facing bill reads go through `v_bill_client` (0014), a
`security_invoker = off` view that does its own `is_member_of()` scoping specifically because no
RLS policy on `bills` covers a Client session.

The practical effect, verified live against a real Client JWT (not service_role, which bypasses
RLS and would have hidden this): a Client session got RLS-filtered to zero `bills` rows before the
view's own `for_roles` array was ever consulted, so a Client never saw "Bill RA-... awaiting
certification" — the one notification that matters most, since AGENTS.md's own rule is "Only a
Client may certify a bill." This predates Build 07 (it was already wrong in 0015) and was never
caught because nothing had queried `v_notifications` from a real Client session until now.

**Fixed** in `supabase/migrations/20260913090005_fix_notifications_bills.sql`: the branch now reads
`public.v_bill_client` instead of `public.bills` directly. `is_member_of()` returns true
unconditionally for `is_admin()` (0002), so Owner/Admin see exactly the same rows as before — this
is a strict widening for Client, not a second, narrower branch. Verified live with a throwaway
Client session (real JWT via `signInWithPassword`, cleaned up after): the notification now appears,
and a direct `select * from bills` from that same session still returns zero rows, confirming the
base table stays closed and the fix is additive only.

### D34 — `LegacyDashboardCards.tsx`'s two TODOs had their build numbers swapped

**Finding, resolved while converting the dashboard's Pending Requests card.** Build 04's own
comment read *"TODO(build-07): Pending Approvals... TODO(build-08): Pending Requests"* — the
opposite of build/07-stock-inventory-notifications.md's own explicit instruction ("§2.5 step 6:
the dashboard's Pending Requests card — the TODO(build-07) left by Build 04") and of what this
build actually covers (stock/inventory/notifications/search; it never touches approvals).
**Fixed**: the Pending Requests card is now real (`getStockRequestsForProject`, passed down as a
prop from the Server Component page). The Pending Approvals card stays on `AppContext` — approvals
are out of this build's scope entirely — and its comment now correctly reads
`TODO(build-08): Pending Approvals`.

### D35 — `v_notifications`'s `stock_request` branch returned zero rows for Site, silently

**Finding, resolved while writing the Playwright bell journey.** The exact same bug class as D33,
one branch over. `stock_request` read `public.stock_requests` directly; that table's only select
policy, `sr_select_admin` (0007), requires `is_admin()` — there is no policy granting Site a
select on the base table at all. Site-facing reads go through `v_stock_request_site` (0014), a
`security_invoker = off` view that does its own `is_member_of()` scoping specifically because no
RLS policy on `stock_requests` covers Site.

Caught by an actual Playwright run under a real Site session — the notifications bell showed only
the `inventory_low` items (5) and zero `stock_request` ones, even though both seeded pending
requests were confirmed still present in the table. It had been masked until then by this build's
own `tests/integration/notifications.test.ts`, whose Site assertion read
`stock_request OR inventory_low` — `inventory_low` alone (that table's select policy genuinely does
include Site) was enough to pass, so `stock_request` being silently empty never surfaced. Fixed in
the same pass: the assertion is now two separate checks, not one `||`.

**Fixed** in `supabase/migrations/20260914090002_fix_notifications_stock_requests.sql`: the branch
now reads `public.v_stock_request_site` instead of `public.stock_requests`. `is_member_of()`
returns true unconditionally for `is_admin()` (0002), so Owner/Admin see exactly the same rows as
before — a strict widening for Site, not a second, narrower branch. Verified live with a real Site
JWT: both seeded pending requests now appear; Admin's own count is unchanged.

### D36 — `next_sr_seq` was never advanced past the seeded `SR-BHEL-NCH-0NN` numbers

**Finding, caught by the integration suite's own rate-strip test failing with a raw Postgres
error.** `next_sr_seq` (migration `20260913090001`) defaulted to 1 for every existing project row,
including the seeded one that already carries `SR-BHEL-NCH-001` through `-016` (Build 02's own
seed, inserted directly with hand-picked ref numbers, long before this build's counter column
existed). The first real `rpc_create_stock_request` calls against that project silently succeeded
up to seq 8, then failed on seq 9 with `duplicate key value violates unique constraint
"sr_ref_uq"` — the exact class of bug `next_bill_seq`'s own seed fix (`supabase/seed.sql`, "Keep
projects.next_bill_seq ahead of the seeded bills") already exists to prevent, just missed when this
build added the stock-request counter. **Fixed** in `seed.sql`: `next_sr_seq` is set to 17
(`update ... where next_sr_seq < 17`), mirroring the bills fix exactly. Verified live.

### D37 — `rate_limits` and `projects.next_sr_seq` were missing from the Drizzle schema

**Finding, caught by `tests/integration/drift.test.ts`.** Both were added to the database by this
build's migrations but never mirrored into `db/schema/` — a real gap the drift test exists
specifically to catch (and did). **Fixed**: `db/schema/search.ts` (new, `rateLimits`) and
`projects.nextSrSeq` added alongside the existing `nextBillSeq`.

### D38 — Applying a migration by raw SQL instead of `supabase db push` let a later CI run silently revert it

**Finding, caught by this build's own PR going through real CI.** Every migration in this build was
applied to `apex-dev` directly via a `postgres` connection (`sql.unsafe(file)`), not through
`supabase db push` — this environment has no working `supabase link` session, and D14 already rules
out a local Postgres to develop against instead. That gets the SQL applied and it can be verified
live, but it does **not** record the migration into Supabase's own `supabase_migrations.schema_migrations`
tracking table, which is exactly what `db push` — the tool CI actually runs — consults to decide
which migration files are still "pending."

The concrete failure: `apex-dev`'s tracking table had never recorded `20260913090005` (D33) or
either of `20260914090001`/`20260914090002` (search/rate-limit, D35) as applied, despite all three
having been applied and verified live by hand. CI's first run correctly saw all three as pending,
applied `20260913090005` fresh (harmless — a `create or replace view`, idempotent on its own), then
failed on `20260914090001` (`rate_limits` already existing from the earlier raw apply) and stopped.
But that first, partial `db push` **did** successfully commit and record `20260913090005` — and
that file's own version of `v_notifications` doesn't contain the later `20260914090002` (D35) fix,
because D35 was found and fixed *after* D33 was written. Reapplying it overwrote the hand-applied
D35 fix on the live view, silently reverting Site's stock-request notifications right back to
broken — caught only because this build's own pgTAP regression test for D35 ran for real in CI
against the actual post-push state, not because anyone looked at the view again by hand.

`supabase migration repair --status applied <version>` (used to reconcile the tracking table
afterward for the two still-mismatched versions) fixes the *bookkeeping* but does not re-run or
verify the file's SQL — repairing `20260914090002` as "applied" without re-running it left the
now-reverted view exactly as `20260913090005`'s reapplication had left it, until reapplied by hand
a second time and confirmed via `pg_get_viewdef` and the pgTAP suite together.

**Consequence for every build after this one**: applying a migration by raw SQL against `apex-dev`
is a legitimate way to get unblocked without a working `supabase link`, but it is not a substitute
for eventually reconciling it — `supabase migration list --db-url "$SUPABASE_DB_URL"` (no link
needed) should show zero `local`/`remote` mismatches before a PR is opened, and any live schema
object touched by more than one migration in the same PR is worth re-verifying with
`pg_get_viewdef`/`\d` after reconciliation, not just trusted from an earlier verification pass.

### D39 — `seed.sql`'s opening-balance movements (D32) were not idempotent

**Finding, caught by CI running `pnpm db:seed` against the same `apex-dev` database on three
consecutive runs of this PR.** Every other row in `seed.sql` carries an explicit id and
`on conflict (id) do nothing`; the six opening-balance `stock_movements` rows added for D32 relied
on `gen_random_uuid()`'s column default instead, with no conflict target at all — and
`stock_movements` is append-only by design (AGENTS.md database rule 6), so there was no natural
constraint to catch a second insert either. Three CI runs meant three inserts: `rpc_inventory_drift`
reported all six seeded items at exactly 3× their real ledger total, each successive run compounding
the last silently.

**Fixed**: explicit ids (`...0901`–`...0906`) and `on conflict (id) do nothing`, matching every other
row in the file. Cleaned up live — deleted all eighteen duplicated rows, re-ran the corrected seed,
confirmed exactly six rows and zero drift, then ran the seed a second time to confirm it now stays
at six.

### D40 — `rpc_inventory_stats` computed `total_value` for every caller, relying on the DTO layer to hide it

**Finding, caught by a full multi-dimensional review of this PR before merge (not by any test — nothing
called this RPC directly from a non-admin session before).** The function's own original comment
said "the CALLER decides whether to even read the column back... `features/inventory/queries.ts` is
what discards it" — exactly the "hide it in the UI" pattern AGENTS.md's own rule says to stop and
flag, not the "never fetch it in the first place" pattern every other admin-only figure in this
codebase uses (role-scoped views omit the column from their SELECT list entirely; `rpc_create_stock_request`
strips `rate` before it's ever stored). A Site session calling `rpc_inventory_stats` directly — its
own grant already permits `authenticated`, which Site is — received the real `unit_cost`-derived
total regardless of what the app's UI does with it.

**Fixed** in `supabase/migrations/20260914090003_rpc_inventory_stats_admin_only_value.sql`: the RPC
itself now returns `total_value = null` for a non-admin caller, computed via `case when
public.is_admin() then ... else null end` — the same defense-in-depth boundary `rpc_create_stock_request`
already applies to `rate`. Verified live with real Site/Admin sessions; `features/inventory/queries.ts`
still discards it too, as the second boundary that pattern always keeps.

### Review findings before merge — fixed and deferred

**Before merging this PR**, a full multi-dimensional review (correctness, security/AGENTS.md
conventions, removed behavior, reuse/duplication, efficiency, simplification, root-cause altitude)
was run across the complete diff. D33, D35, D36, D38, D39 above were all found and fixed *during*
the build; this pass found several more. Fixed:

- **D40** above (`rpc_inventory_stats`).
- `NewRequestDialog`'s `moduleId` prop was accepted but silently unused — the "+ Stock Request"
  button on a package's own detail page (`PackageDetailActions.tsx`, a live, untouched caller) lost
  its package pre-select. Restored.
- `NewRequestDialog`'s Rate-field visibility used `session.role` (the REAL role) instead of the
  effective role (`useApp().role`) — contradicted its own doc comment and broke the impersonation
  preview's fidelity for Owner/Admin previewing as Site (not a security hole: the server action
  separately, correctly, re-derives admin-ness from the real role for the write boundary). Fixed to
  use the effective role, matching every other read-shaping check in this build.
- `createStockRequestSchema`'s `rate` field used `z.coerce.number()` before `.optional()` ever saw
  the value, so a blank Rate input coerced `""` to `0` — a real rate of zero, not "unspecified."
  Fixed with the same `""` → `undefined` preprocessing shape used elsewhere in the same schema.
- `features/search/queries.ts`'s `ilike` patterns didn't escape `%`/`_`/`\` in the user's own query
  text, so a search containing those characters was interpreted as wildcards instead of literal
  text (e.g. searching "M_20 grade concrete" matched far more than the literal substring). Fixed
  with an escaping helper.
- `ReqTable`'s Value column used a truthy check (`r.value ? ... : "–"`) instead of `!= null`, so a
  real rate of exactly ₹0 rendered as "–" (unknown), indistinguishable from no rate at all. Fixed.
- `InventoryTable`'s empty-state `colSpan` was keyed on `showProject` alone, not updated when
  `isAdmin` was added as a second conditional column — under/over-spanned the empty row for a
  non-admin viewer. Fixed to account for both.
- `PackageFilterSelect` (Build 06, reused here alongside the new `StockStatusTabs`) rebuilt the
  query string from just its own `package` param, silently dropping the `status` tab selection
  when a user changed the package filter on the new Stock page — its original caller (Daily
  Updates) has only one filter, so this never showed up there. Fixed to merge into the current
  search params instead of replacing them (and to explicitly reset `cursor`, so the original
  caller's pagination still restarts on a filter change, matching its previous behavior).

**Deferred — real findings, not fixed in this pass, with reasons:**

- **`rpc_adjust_inventory` (and, on inspection, several sibling RPCs) have no `org_id`/project
  membership check beyond `is_admin()`.** This looked like a Build 07-specific gap at first, but
  `is_member_of()` itself (migration 0002, Build 02) returns `true` unconditionally for any
  `is_admin()` caller regardless of the target project's own org — so the *other* RPCs in this same
  file that do call `is_member_of()` before touching a row don't actually enforce cross-org
  isolation for an admin either. This is a systemic characteristic of the whole RPC layer since
  Build 02, not a regression this PR introduces or fixes by patching one function. D3 already
  accepts single-org-for-now with `org_id` on every table "for when it's needed" — worth a
  dedicated multi-tenancy hardening pass before any real second org exists, not a one-RPC patch
  here that would give false confidence while leaving every sibling RPC exactly as exposed.
- **Every delivered stock request with no `inventory_item_id` creates a brand-new inventory item**,
  rather than matching an existing one by name — two separate requests for identically-named
  material become two separate, un-merged inventory rows, and the auto-created row's
  `reorder_level` is hardcoded to `0` (never triggers Low/Critical). This matches `02-lld.md`
  §5.4's own literal pseudocode exactly (which also never looks up an existing item by name or sets
  a reorder level) — a real product gap, but a documented one in the implementation contract itself,
  not a shortcut this build took. Worth raising as a follow-up build item (name-based matching, or
  requiring `inventoryItemId` once a material has been delivered once before), not a fix to make
  unilaterally against the LLD's own contract.
- Search no longer matches a project by its client's name (the old mock's `buildSearchResults` did).
  Not a regression against anything the build spec asked for (`§2.7` names the seven entity types
  searched, not "or a project's client") — a possible enhancement, not a fix.
- The phase captured on stock request creation (`phase_id`) is stored but never displayed in
  `ReqTable` (only the package is). Minor, real, deferred.
- `e2e/schedule-journey.spec.ts`'s "widens the viewport" test lost its direct DB-persistence check
  when its cleanup was made name-based instead of id-based (see the finding above this file already
  records for that same change) — it still asserts the task is visible and the viewport widened,
  just not a direct `select` confirming the row exists in Postgres. Minor test-coverage regression,
  not reverted because the id-based version is what left a stray row behind in the first place.
- Several duplication/reuse and sequential-await-instead-of-`Promise.all` findings across
  `features/search/queries.ts`, `features/inventory/queries.ts`, `features/stock/queries.ts`, and
  `app/(app)/projects/[projectId]/page.tsx` (a shared `isAdminRole`/`isMoney` predicate reimplemented
  inline in ~10 places instead of reused from `features/stock/service.ts`/`lib/logic.ts`;
  `fetchProjectNames`-shaped helpers copy-pasted across `features/inventory/`, `features/notifications/`,
  and `features/search/`; a handful of pages awaiting independent queries in sequence rather than via
  `Promise.all`). All real, none correctness bugs — noted for a follow-up cleanup pass rather than
  reworked under merge pressure across a dozen files at once.

### D41 — the attachments-freeze RLS policy required a PENDING approval to already exist, blocking the create flow

**Finding, caught while implementing `features/approvals/actions.ts`** (build/08-approvals.md §2.2/§2.4),
not by any test written before this point — the first round of live verification for the freeze
policy only ever exercised it against an approval that already existed. Migration
`20260915090003_freeze_approval_attachments.sql`'s own predicate was `entity_type <> 'approval' or
exists (select 1 from approvals a where a.id = entity_id and a.status = 'pending')` — read literally,
an attachment insert against an approval id that doesn't exist YET (no row at all) fails that `exists`
check exactly like one against a decided approval does. That is precisely `NewApprovalDialog`'s own
create flow: `rpc_create_approval` takes a client-generated `p_id` so `FileUploader`'s sample photos
can upload and confirm *before* the row exists (0035's own comment, the same pattern `daily_updates`
established in Build 06) — every one of those uploads would have been silently refused.

**Fixed** in `supabase/migrations/20260915090004_fix_approval_attachment_freeze.sql`: the predicate is
`not exists (select 1 from approvals a where a.id = entity_id and a.status <> 'pending')` instead — this
is vacuously true (and therefore allows the insert) when no row exists yet, and only becomes false once
a row exists and has moved past pending. Applied via `pnpm exec supabase db push`, per D38's own lesson;
never edited the already-applied 0036 in place, per AGENTS.md database rule 1. Re-verified live against
`apex-dev` from real signed-in sessions: insert-before-create succeeds, insert-while-pending succeeds,
insert-after-decided is refused, delete-after-decided is refused even within the 24-hour uploader
window. Both directions are now also regression-tested in `tests/integration/approvals.test.ts`.

### D42 — the Approvals "All" tab silently re-defaulted to "Pending"

**Finding, caught by the client mobile-viewport Playwright journey** (`e2e/approvals-journey.spec.ts`),
not by unit or integration tests — this is a client-navigation bug, not a data or RLS one.
`ApprovalStatusTabs`'s "All" tab (`key: ""`) built its URL as `nextStatus ? `${basePath}?status=${nextStatus}` : basePath` — for `nextStatus = ""` that is falsy, so it navigated to the bare
`basePath` with **no** `status` query param at all. The page itself treats an *absent* `status` param
as "never visited this page before, default to Pending" (`rawStatus === undefined ? "pending" : ...`)
— a necessary rule so a fresh visit opens on Pending, not All, per `docs/ui-guide.md` §6.10's own
default. Those two rules collided: clicking "All" from any other tab produced a URL indistinguishable
from a fresh visit, so the page silently bounced back to the Pending-filtered view instead of showing
every row — a real, user-facing defect (a client trying to see approval history since decided rows
leave the Pending tab entirely) that would have shipped with zero automated coverage catching it, since
every other test in this build filtered by an explicit status rather than exercising the tab click
itself.

**Fixed** in `components/domain/ApprovalStatusTabs.tsx`: `navigate` always sends an explicit
`?status=${nextStatus}`, never a bare path — `?status=` (empty) is now distinguishable from no param
at all. Verified live via the Playwright journey that found it (approve, then check the row under
"All"), and via the admin supersession journey (which needs both a rejected and a pending row visible
together).

### Review findings before merge — fixed and deferred

**Before merging this PR**, a full multi-dimensional review (correctness, security/AGENTS.md
conventions, removed behavior, reuse/duplication, efficiency, simplification, root-cause altitude) was
run across the complete diff, five independent passes. D41/D42 above were both found and fixed *during*
the build; this pass confirmed both are genuinely correct and found several more. Fixed:

- **Double-supersession race**: `rpc_create_approval` read the superseded approval's status without a
  row lock and never checked whether it already had a successor — two concurrent "Raise revised
  approval" calls against the same rejected row (a double-click, or two sessions racing) could both
  succeed, and `features/approvals/queries.ts`'s own `supersededByRefNoBySupersedesId` map (keyed by
  `supersedes_id`) would silently drop one of the two forward links from the UI. Fixed in migration
  `20260915090005_fix_approval_supersession_race.sql`: `select ... for update` on the target, plus an
  "already superseded" existence check evaluated only after that lock is held (so the second caller's
  check runs against the first caller's now-committed insert, not a stale snapshot) — the same tool
  `rpc_transition_stock_request`/`rpc_decide_approval` already use for this exact race class. Verified
  live (concurrent `Promise.all` calls, exactly one succeeds) and regression-tested in
  `tests/integration/approvals.test.ts`.
- **Missing `deleted_at is null` filters** in `features/approvals/queries.ts`: `fetchPackageNames`'s
  admin branch, `fetchPhaseNames`'s admin branch, `fetchProfileNames`, and the `missingSupersedeIds`
  fallback lookup all read base tables without the filter AGENTS.md database rule 7 requires
  unconditionally ("every query filters `deleted_at is null`"). Fixed — all four now filter. (The
  identical `fetchPackageNames`/`fetchProfileNames` shape in `features/updates/queries.ts` and
  `features/stock/queries.ts` has the same gap and predates this build; not fixed here as it's outside
  this PR's diff, flagged below as pre-existing, systemic debt.)
- **D41's own fix didn't account for a soft-deleted approval**: the widened freeze predicate
  (`not exists (... where status <> 'pending')`) is vacuously true for a row that exists, was
  soft-deleted, but whose `status` was never changed off `'pending'` — nothing deletes an approval today,
  but the column exists for a reason. Fixed in migration
  `20260915090006_freeze_approval_attachments_deleted.sql`: the predicate now also treats
  `deleted_at is not null` as frozen.
- `ApprovalTable.tsx`'s "Raise revised approval" gate re-implemented `canSupersede(status)` inline as
  `a.status === "rejected"` instead of using the pure, unit-tested helper — contradicting the file's own
  doc comment, which already claimed per-row actions come from `canDecide`/`canAddPhotos`/`canSupersede`
  on the DTO. Fixed: `ApprovalDTO` now carries a real `canSupersede` field (`getApprovalsForProject`),
  and the table reads it instead of re-deriving the rule.
- An invalid or unrecognized `status` query param (a stale link using the pre-conversion mock's
  capitalized values, a typo) was indistinguishable from the deliberate "All" tab click and silently
  showed every approval instead of falling back to the documented "pending" default. Fixed in
  `approvals/page.tsx`: only the exact empty string (`ApprovalStatusTabs`'s own explicit "All" value)
  means no filter; anything else unrecognized now falls back to "pending", same as an absent param.

**Checked and confirmed not an issue**: `addSamplePhotos` has no cumulative per-approval photo-count
cap of its own — but `requestUploadUrl` (`features/attachments/actions.ts`) already counts *all*
existing, non-deleted attachments for the entity before issuing a new upload URL, so the real
`MAX_PHOTOS_PER_ENTITY` enforcement is already at the shared upload layer every entity type goes
through; a second copy in `addSamplePhotos` would be redundant.

**Deferred** (real, not correctness/security-critical, not reworked under merge pressure):

- The `fetchPackageNames`/`fetchPhaseNames`/`fetchProfileNames`/`fetchAttachments` helpers in
  `features/approvals/queries.ts` are near-verbatim copies of the same-named helpers in
  `features/updates/queries.ts` and `features/stock/queries.ts` — a pre-existing duplication pattern
  this build continues rather than originates; a shared-helper extraction is a follow-up cleanup, not
  a per-PR fix (same reasoning Build 07's own review entry gives for its equivalent finding).
- The client-role Approvals nav badge in `components/layout/Sidebar.tsx` still counts from
  `AppContext`'s frozen mock `data.approvals`, exactly like the Stock and Bills nav badges next to it
  (`data.requests`, `data.bills`) — a pre-existing, cross-domain gap since Build 04, not something this
  build introduced or is positioned to fix in isolation without converting all three at once.
- `missingSupersedeIds`'s fallback lookup runs as one extra sequential round trip after the main
  `Promise.all` rather than being folded into it — a real, minor inefficiency on the rare page view
  where a superseded target falls outside the current filter/page.
- `NewApprovalDialog`'s `supersedes.type` prop is cast to `ApprovalType` without runtime validation;
  low risk since its only source today is a live `ApprovalDTO.type` read straight off the enum column.

---

### D43 — Overpayment: refuse the record, or clamp it silently?

**Question:** `build/09-billing.md` §4.5 leaves this open: "decide, document, and test whichever" for
a payment that would push `Σ payments` past `net_payable`.
**Decided:** 2026-09-11, this build
**Answer:** Refuse. `rpc_record_payment` raises a new `OVERPAYMENT` domain error
(`lib/safe-action.ts`'s `ERROR_MESSAGES`, following the established prefix-coded pattern) rather than
clamping the amount or letting Outstanding go negative.
**Reasoning:** A clean, explicit error at the point of entry is recoverable — the admin corrects the
figure and re-submits. A silent clamp hides a real data-entry mistake (the wrong bill, a transposed
digit) behind a payment that quietly doesn't match what was actually received, and a negative
Outstanding is exactly the kind of "derived value that can go stale/lie" AGENTS.md already forbids
storing — it would be worse to let one exist transiently in a live figure a client sees.
**Consequence:** `features/billing/actions.ts`'s `recordPayment`, `RecordPaymentDialog.tsx`'s
field-level pre-check, and `tests/integration/billing.test.ts`'s own overpayment test all assume
refusal, not clamping.

---

### D44 — Mobilisation advance recovery: the concrete mechanism (D7 made concrete)

**Question:** D7 decided advance recovery is tracked; Build 09 had to decide the actual recovery
formula and where its rate lives.
**Decided:** 2026-09-11, this build
**Answer:** A new per-project column, `projects.mobilisation_recovery_pct` (`numeric(6,3)`, default 0,
checked 0–100), migration `20260916090001_mobilisation_recovery_pct.sql`. Each bill's own
`advance_recovery` (HLD §8.4 step J) is
`least(remaining advance (mobilisation_advance − mobilisation_recovered), taxable × mobilisation_recovery_pct / 100)`
— automatic, computed by `rpc_create_bill` on every bill, not a manually-entered figure per bill.
**Reasoning:** Matches the LLD's own pseudocode for step J exactly, and keeps the recovery mechanism
symmetric with `mas_billable_pct`/`retention_pct`/`tds_pct` — one rate column per project, snapshotted
onto nothing (recovery is recomputed fresh each bill against the running `mobilisation_recovered`
balance, which is itself the thing being tracked, not a snapshot).
**Consequence:** Defaults to 0 — no project recovers any advance until Apex confirms a real schedule
per project. Cancelling a draft bill reverses its own `advance_recovery` out of
`mobilisation_recovered` (that money was never actually netted against a real invoice) —
`rpc_transition_bill`'s `draft → cancelled` branch.

---

### D45 — CGST/SGST split: kept as one `gst_amount` column

**Question:** `01-hld.md` §8.4's own open tax questions ask whether GST should split into CGST+SGST
(intra-state) vs IGST (inter-state) rather than one blended figure.
**Decided:** 2026-09-11, this build — **not decided, deliberately deferred, same treatment as D4**
**Answer:** Kept the single `gst_amount` column the schema has carried since Build 02 (D6/`02-lld.md`
§3.8). No CGST/SGST/IGST split exists anywhere in `bills`, `bill_lines`, the PDF, or the Excel export.
**Reasoning:** Splitting the tax line is exactly the kind of thing this build's own framing warns
against deciding in code review — it changes what number appears on a document going to an assessing
officer. Apex is a single-state contractor in the seed data (no evidence of inter-state billing in
scope), so blended GST may be entirely correct for their actual invoices; that is the CA's call, not
this build's guess.
**Open:** CA confirmation, alongside D4 and the five §8.4 tax questions. If a split is required, it is
a schema change (two or three amount columns replacing one) and a PDF/Excel layout change, not a
one-line fix — flagged now so it isn't discovered at the first real bill.

---

### D46 — Retention release: no schedule, deducted and never released

**Question:** `01-hld.md` §8.4's own open tax questions also ask about a retention release schedule
(e.g., 50% released at handover, 50% after the defect liability period).
**Decided:** 2026-09-11, this build — **not decided, deliberately deferred**
**Answer:** `bills.retention_amount` (HLD §8.4 step H) is deducted from every bill and never released
anywhere in the schema — there is no `retention_released` table, column, or RPC. Retention simply
lowers `net_payable` forever, on every bill, with no path back to the client.
**Reasoning:** No release schedule was ever specified in any build document, and inventing one (a
percentage, a trigger event, a waiting period) would be exactly the kind of undocumented business
rule AGENTS.md's "when you are unsure" section says to flag rather than decide.
**Open:** If Apex needs retention release tracking, it is new scope for a later build — a
`retention_releases` table (or similar) recording when and how much of the accumulated retention
across a project's bills was actually paid back, referenced nowhere in Build 09.

---

### D47 — Sub-daily cron on Vercel Hobby: GitHub Actions, not a Pro upgrade

**Question:** ADR-016 accepted Vercel Pro partly because Build 06's `jobs.drain` needs per-minute
cron. Pro has not been purchased and production runs on Hobby, where `vercel.json`'s `* * * * *`
schedule **fails the entire deployment**. Buy Pro now, or schedule the frequent jobs elsewhere?
**Decided:** 2026-09-16 by Voola — **schedule them from GitHub Actions. Do not upgrade.**
**Answer:** The two sub-daily entries (`jobs.drain` every minute, `jobs.reap` hourly) are removed
from `vercel.json` and triggered instead by `.github/workflows/jobs-drain.yml` (`*/5 * * * *`) and
`jobs-reap.yml` (`0 * * * *`), each a `curl` to the same `/api/cron/<job>` route carrying the same
`Authorization: Bearer ${CRON_SECRET}`. The three daily-or-weekly crons stay on Vercel — they are
legal on Hobby and already run in-region.

**Reasoning:** The Hobby limit is on cron *frequency* (one invocation per day each, ~hourly
accuracy), not on the number of crons — 100 are allowed. So only two of the five entries were ever
the problem, and the fix is correspondingly narrow. GitHub Actions is already a trusted caller of
this app (`backup-nightly.yml` posts to `/api/backup/report` with the same secret), so this adds no
new trust relationship, no new credential, and no new service. Nothing about job *execution* moved:
the workflows are pure triggers, and all work still runs in the Vercel function against Postgres.

**Consequence — a real cost, recorded rather than hidden.** GitHub's shortest schedule interval is
5 minutes and its scheduler is best-effort, dropping delayed runs rather than backfilling them.
`architecture.md` §8.1's "Bill PDF available within 60 s of submission" is therefore **relaxed to 5
minutes typical**. This is latency only — submitted work waits in the `jobs` table and the next tick
drains it, so the >99% job-success SLO is untouched. A second consequence: GitHub disables scheduled
workflows after 60 days of repository inactivity, so drain and reap can stop silently; `backup.verify`
remains on Vercel Cron and still alerts, which bounds how long that goes unnoticed.

**Not closed by this.** ADR-016's other two justifications — Supabase PITR, and Hobby forbidding
commercial use by a system that issues tax invoices — are untouched and still outstanding. This
decision is "Pro is not required *for cron*", not "Pro is not required".

**The way back to 60 s, without Pro:** drain inline when the job is enqueued (a `bill.pdf` drain
kicked off from `features/billing/actions.ts` after the response, with the 5-minute poll kept as the
retry safety net). Deliberately not bundled into the scheduling fix, because it changes the billing
submit path.

---

### D48 — No two-factor authentication for any role

**Question:** `architecture.md` T12 made TOTP mandatory for `owner`/`admin`, enforced by
`requireAalForRole`, but no enrollment screen was ever built (D22), so no real owner or admin could
perform any admin action. Build the enrollment screen, or drop the requirement?
**Decided:** 2026-09-17 by Voola — **drop it. Email + password only, for every staff role, with a
show/hide toggle on the password field.** Clients keep the magic link.
**Answer:** `requireAalForRole` and the session's `aal` field are removed (`lib/auth/session.ts`);
the login form has no code step; `e2e/global-setup.ts` no longer enrolls a factor. Supabase's
project-level TOTP setting is left as it is and simply unused. The enrollment screen built as PR #22
was closed unmerged.

**Consequence — recorded, not hidden.** T12 (credential stuffing on staff logins) loses its second
control: an owner/admin account is now protected by its password alone, and those accounts see
internal cost and margin. Strong, unique passwords for owner/admin, and changing the seeded
`apex-dev-only` password on every production account (`docs/open-issues.md` #4), matter more as a
result. Supabase's own sign-in rate limits (`supabase/config.toml` `[auth.rate_limit]`) still apply.

---

### D49 — One Supabase project, which is production; automatic CI paused

**Question:** There is exactly one Supabase project. Vercel Production, `.env.local` and CI all point
at it, and CI's `migrations · seed · RLS · drift` job ran `supabase db push`, the **seed**, the pgTAP
suite and the integration tests against it on **every pull request** — writing demo and test rows
into the live database. Split it into a second (`apex-prod`) project, or something else?
**Answered:** 2026-09-17 by Voola
**Answer:** **One Supabase project, and it is production.** No second project is to be created. The
CI/CD pipeline is not needed yet and standing it up safely would take longer than it is worth right
now, so **automatic CI is paused** rather than repaired: `.github/workflows/ci.yml` keeps every job
it had but is triggered by `workflow_dispatch` only. The separate-project work proposed as PR #25 is
superseded and is not merged.
**Consequence:**

- Nothing runs `db push`, the seed or the integration suite on a pull request any more, which is what
  removes the immediate danger. Nothing else about the workflow changed — restoring the
  `pull_request` and `push` triggers is the whole of re-enabling it, and must not happen until the
  `database` job has a database that is not the live project.
- **The durable protection is in the scripts, not in CI.** `scripts/lib/db-target.mjs` holds one
  production-ref guard, used by `db:reset`, `db:seed`, `db:bootstrap`, the `spike:d15` script, the
  pgTAP runner (`pnpm test:rls`) and the integration suite's setup. Each refuses when its target
  resolves to `SUPABASE_PROD_PROJECT_REF` — and, new here, refuses on a non-interactive run when that
  variable is absent, because an unset guard used to mean no guard at all. The integration suite also
  checks `NEXT_PUBLIC_SUPABASE_URL`, since its supabase-js sessions write through the API, not the
  database URL.
- With CI off, `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build` run
  locally is the only gate before a push. `tests/db-target.test.ts` is what keeps the guard honest.
- Unaffected, deliberately: `backup-nightly.yml`, `jobs-drain.yml` and `jobs-reap.yml`. Those are
  production operations, not CI, and keep their schedules.
- D10 (a Supabase preview branch per PR) is not withdrawn but is not in effect: preview branching
  needs a paid plan and a `SUPABASE_ACCESS_TOKEN` that this repository does not have. Until one
  exists, "CI has its own database" remains unfunded, which is precisely why CI is paused instead of
  re-pointed.

---

### Findings from Build 09 (Billing)

**A real, live-caught correctness bug, the most serious one this build found:** `rpc_create_bill`'s
own bill-number generation, `lpad(v_seq::text, 2, '0')`, was written to zero-pad small sequence
numbers (`'1' → '01'`) but Postgres's `lpad` **truncates** a string already longer than the target
width rather than leaving it alone — `lpad('174', 2, '0')` returns `'17'`, not `'174'`. Once a
project's own `next_bill_seq` passes 99 (an ordinary outcome of a few years of monthly RA billing on
one project, and an outcome this build's own heavy live verification reached in a single day), every
bill in the same ten-wide bucket (170–179, 180–189, ...) is assigned the *identical* truncated
`bill_no`. The first bill in a bucket succeeds; every other one hits `bills_no_uq (org_id, bill_no)` —
a real `unique_violation`, caught by the function's own defense-in-depth
`exception when unique_violation` backstop (there for the double-billing index) and **misreported as
`ALREADY_BILLED`**, actively pointing away from the real cause. Found when
`tests/integration/billing.test.ts`'s T-02 and T-03 both started failing for a reason neither test's
own logic had anything to do with, after this session's own verification work pushed a dev project's
counter past 99. Fixed in migration `20260916090007_fix_bill_no_truncation.sql`: the bill number is
now built with a `case` that zero-pads only when `v_seq < 10` and uses the number as-is otherwise,
never relying on `lpad`'s truncating behavior. Regression-tested directly: a bill forced to
`seq_no = 174` produces `bill_no = 'RA-BHEL-NCH-174'`, not `'...-17'`.

**Other bugs found only by actually running this build, not by reading the code:**

- **`rpc_create_bill`'s aggregate query had ambiguous column references.** Joining `v_billable_now`
  (aliased `bn`) against `jsonb_to_recordset(p_lines)` (aliased `sel`) — both carry
  `source_type`/`source_id` — meant every unqualified reference in the `SELECT` list was ambiguous.
  Caught on the first live smoke test ("column reference is ambiguous"). Fixed in migration
  `20260916090005_fix_create_bill_ambiguous_columns.sql`, qualifying every reference as `bn.*`.
- **`bills_idem_uq`/`payments_idem_uq` as `unique nulls not distinct` failed immediately against
  seeded data.** Every pre-existing seeded bill/payment has a `null` `idempotency_key`; `unique nulls
  not distinct` treats every `null` as equal to every other `null`, so the very first migration push
  failed with a duplicate-key error against rows that were never meant to collide. Fixed by switching
  to a **partial unique index** (`where idempotency_key is not null`) instead — the property this
  build actually needs (a client-generated key is unique when present) without penalizing rows that
  never had one.
- **`BillingAdmin.tsx`'s idempotency key was generated once per component mount, not once per create
  attempt.** `useState(() => crypto.randomUUID())` with no setter meant every bill created after the
  *first* one from the same mounted Billable Now table would silently collide with the first bill's
  own idempotency key — `rpc_create_bill`'s own idempotency check would treat the second, genuinely
  different selection as a duplicate of the first and return the stale first bill instead of creating
  a new one. This is the same failure class the Excel/PDF-in-a-dialog convention exists to avoid
  (returning stale data silently rather than an error) and would have been very hard to notice in
  practice, since the returned bill is real, just wrong. Fixed: the key regenerates via
  `setIdempotencyKey(crypto.randomUUID())` after every create attempt, success or failure.
- **`uploadBillCopy` was written with `adminAction`, but `02-lld.md` §7's own API table lists it as
  `admin, site`.** Self-caught during implementation, not by a test — fixed to use `siteAction`.
- **The Vitest coverage threshold glob, written in Build 01 before any billing code existed, covered
  the whole `features/billing/**` directory at 100% branch.** That includes `actions.ts`/`queries.ts`
  — thin Supabase-calling wrappers with no meaningful unit-testable branch logic, by this codebase's
  own established convention of testing those via integration tests instead, the same as every other
  feature folder. The first coverage run failed outright ("Coverage for lines (8.47%) does not meet
  `features/billing/**` threshold"). Fixed by scoping the threshold to
  `features/billing/service.ts` specifically, matching the build file's own literal wording:
  "100% branch on `features/billing/service.ts` and every billing RPC path."

### Review findings before merge — fixed and deferred

Before merging this PR, a full multi-dimensional review (correctness, security/AGENTS.md
conventions, removed behavior, reuse/duplication, efficiency, simplification, root-cause altitude)
ran across the complete diff. Fixed:

- **A Site Supervisor could read a bill's full financials** (`taxableAmount`, `gstAmount`,
  `netPayable`, line amounts) by calling the exported `getBillDetailForDialog` Server Action
  directly — the single most serious finding of this pass, a direct violation of AGENTS.md's "Site
  Supervisors see no money at all." The billing page itself calls `forbidden()` for site, but that
  page-level gate was the *only* thing standing between a site session and this data:
  `getBillDetailForDialog` called `requireSession()` (any authenticated user) rather than a role
  check, and `getBillDetail`'s own non-admin branch reads `v_bill_client`/`v_bill_line_client`,
  which are gated only by project membership, not role (confirmed live: a signed-in site session
  can `select` directly from `v_bill_client` and get real bill rows back). Fixed: the action now
  calls `requireRole(["owner", "admin", "client"])` — `viewBilling`'s own list
  (`lib/rbac/permissions.ts`) — before ever reaching `getBillDetail`. Every other reachable path
  into `v_bill_client`/`v_bill_line_client` was individually traced and confirmed already safe
  (each is gated by an explicit role branch at its own call site: `getBillsForClient` behind the
  billing page's `forbidden()`, `getClientBillingStats` behind a `packages.role === "client"`
  render branch, `searchBills` behind `isSite ? [] : ...`) — this was the one gap, not a pattern.
- **`rpc_create_bill`'s MAS recovery counted material `bill_lines` from a still-draft bill**, not
  only committed ones — no filter on the owning bill's own `status`. Sequence: admin bills a
  delivered material against phase P as bill A (left in draft), then bills phase P's own completed
  milestone as bill B before resolving A; B's `mas_recovery_amount` is reduced by A's line even
  though A isn't a finalized invoice, and if A is later cancelled (its `bill_lines` hard-deleted,
  the one deliberate exception to soft delete), B's already-snapshotted taxable/GST/net figures
  permanently understate what the client owes — bills are immutable once created, so there is no
  way back. Fixed in migration `20260916090008_fix_mas_recovery_counts_draft_bills.sql`: the
  recovery query now joins `bills` and excludes `status = 'draft'`. Regression-tested directly
  (`tests/integration/billing.test.ts`: a draft material bill contributes zero MAS recovery to a
  later phase bill) and the pre-existing T-02 test was corrected to submit its own material bill
  first, matching the real admin workflow the RPC was silently not requiring.
- **Four exported billing reads never called `assertBillingEnabled()`** (`getBillPdfUrl`,
  `getBillableNowForAdmin`, `getBillDetailForDialog`, `getBillPaymentsSummaryForDialog`),
  contradicting the file's own doc comment that the flag is "checked... in every billing action."
  With `BILLING_ENABLED=false`, a caller with a stale or guessed `billId` could still reach real
  bill data through these four even though the pages themselves return `notFound()`. Fixed: all
  four now assert first, matching every mutating action in the same file.
- **`BillViewDialog`'s non-admin "Download PDF" opened its tab *after* an `await`**, losing the
  click's synchronous user-gesture context — every major browser's popup blocker silently
  swallows a `window.open` issued outside that stack, so the button did nothing and gave no error.
  Fixed: the tab now opens synchronously (blank), then gets its `location` set once the presigned
  URL resolves — the standard pattern for a URL a click needs to await before it's known.
- **`getBillPdfUrl`'s attachment lookup couldn't tell the system-generated invoice PDF from an
  admin-uploaded scanned bill copy** — both share `entity_type='bill'`/`entity_id=billId` with no
  discriminating column, so it just returned whichever was newest. If an admin uploads a scan
  *after* the real PDF has generated, every subsequent "Download PDF" click (any role) would
  return the scan instead of the actual GST invoice. Partially mitigated by filtering on
  `mime_type = 'application/pdf'` (narrows out the common case — a photo); a scanned copy uploaded
  *as* a PDF would still collide. A complete fix needs a real discriminator column (e.g. a `kind`
  distinguishing "generated" from "uploaded") — tracked below as a follow-up, not blocking.

**Deferred** (real, not correctness/security-critical, not reworked under merge pressure):

- The `lpad` truncation pattern this PR found and fixed for `bill_no` (D-findings above) is still
  present, unfixed, in `rpc_create_stock_request` (`SR-<code>-<seq>`) and `rpc_create_approval`
  (`AP-<code>-<seq>`) — both predate this build and use the identical
  `lpad(v_seq::text, 3, '0')`, which will truncate the same way once either counter passes 999.
  Out of this PR's scope (touching either RPC is a different feature's own migration); flagged so
  it isn't rediscovered the hard way like `bill_no` was.
- `getMaterialAtSite` (`features/billing/queries.ts`) re-derives the phase→package→1.0
  cost-to-client fallback in TypeScript instead of importing `costToClientFactor` from
  `features/packages/service.ts`, which already implements and unit-tests the identical rule. The
  two agree today; a future change to one won't propagate to the other. Left as-is rather than
  risk a cross-feature import under merge pressure — a follow-up, not a blocker.
- `packageLabelsByBill`'s client branch recovers a package name by splitting
  `v_bill_line_client.description` on `" — "` rather than the view carrying a real column for it —
  fragile against a future format change, and already incomplete (a material line's description
  never contains a package name at all, acknowledged in the code's own comment).
- `BillingAdmin.tsx` fetches its own "Billable Now" rows via a client-side `useEffect` calling a
  Server Action, rather than receiving them as a prop from the Server Component page that already
  fetches adjacent billing data — a real extra round trip on every page view, and a
  code-standards §3 "never fetch in a Client Component" gap, though not a security issue (the
  action it calls is properly role-scoped).
- `getAdminBillingStats`/`getClientBillsStats` each independently re-fetch the full bill list
  (with its own package-label join fan-out) that the billing page already fetched directly,
  roughly doubling Supabase round trips per page load.
- `ADMIN_BILL_COLUMNS`/`CLIENT_BILL_COLUMNS` are two independently-maintained column-list strings
  rather than one derived from the other; `BillingAdmin.tsx`/`BillingClient.tsx` duplicate the
  same "which timestamp to show" status-timeline formatting; both re-implement the margin-percent
  formula inline instead of reusing `pct()` from `lib/logic.ts`.
- `components/layout/Sidebar.tsx`'s nav badge still counts from `AppContext`'s frozen mock
  `data.bills` for "bills pending" — the same pre-existing, cross-domain gap Build 08 documented
  for its own equivalent Approvals badge, not something this build introduced or is positioned to
  fix in isolation.
- ~~The `bill.pdf` job's idempotency key (`${billId}:submitted`) doesn't vary by `revision`, so a
  bill that is submitted, rejected, and resubmitted keeps the same key and never regenerates its
  PDF — the client would certify against a stale, pre-correction document. `RecordPaymentDialog`'s
  own idempotency key is also never regenerated after a failed submit attempt (unlike
  `BillingAdmin`'s create-bill flow, which does, per its own documented fix above). Both are real,
  narrow-trigger gaps worth a follow-up.~~ **Fixed 2026-09-17** (`fix/billing-correctness`). The
  key is now `billPdfJobKey(billId, revision)` (`features/billing/pdf.ts`, 100% branch), and the
  handler's own "already generated?" check is keyed on `billPdfFileName(bill_no, revision)` read
  from the bill row, so a resubmission escapes both `jobs_idem_uq` and the handler's early return
  while the superseded document stays on the bill as the record of what the client was shown
  before. No figure is recomputed: a regenerated PDF re-renders the columns `rpc_create_bill`
  snapshotted, which stay immutable from `submitted` onward; what it picks up is the live half of
  the document (Apex's and the client's own GSTIN/PAN/address/bank block), which is usually why a
  bill was rejected in the first place. `RecordPaymentDialog` now regenerates its key after every
  attempt, exactly as `BillingAdmin` does.
- ~~`BillingAdmin`'s "Billable Now" table is never refreshed after a successful `createBill` — the
  just-billed rows stay visible and selectable until the next full page load, so re-selecting and
  submitting again produces a confusing `ALREADY_BILLED` the admin didn't cause.~~ **Fixed
  2026-09-17**: the effect's fetch is now a named `loadBillable`, re-run after a successful create
  alongside `router.refresh()` — the refresh only re-renders the server components, never this
  component's own client-side fetch (the underlying "it shouldn't be a client-side fetch at all"
  gap, two bullets up, is untouched and still open).

**Investigated and found not to be a gap (2026-09-17):** "recording a payment leaves a stale bill
PDF the client then certifies against." It cannot happen, in two independent ways.
`rpc_record_payment` refuses any bill not already `certified` or `paid`, so certification strictly
precedes the first payment — there is no order of events in which a client certifies after a
payment. And a payment changes no figure the PDF renders: it inserts into `payments` (never a
`paid_amount` column on `bills`) and at most flips `status`/`paid_at`, while `BillPdfData` carries
no payment, balance or outstanding field at all. Regenerating a PDF on payment would have been
motion against AGENTS.md's own "bills are immutable from `submitted` onward" for no gain, so it
was deliberately not done.
- Migrations `20260916090003`/`090005`/`090007`/`090008` are four successive full rewrites of
  `rpc_create_bill`, each correcting a real bug found after the previous one shipped — the
  intended trail per AGENTS.md database rule 1 ("never edit an already-applied migration"), not
  squashed for a cleaner history, since by the time each bug was found the previous migration had
  already been applied to the shared `apex-dev` project.

---

### D49 — Sentry removed entirely

**Question:** Sentry was wired in Build 01 §3.13 but has never reported an event: no organisation,
DSN or auth token was ever created (`progress-tracker.md`'s own blocker list, raised 2026-09-09), so
`enabled` evaluated to `false` in every environment and `withSentryConfig` uploaded nothing. Create
the organisation, or drop it?
**Decided:** 2026-09-17 by Voola — **drop it. Out of scope for v1.** No third-party error-tracking
service.
**Answer:** `@sentry/nextjs` is gone from `package.json` and the lockfile; `sentry.server.config.ts`,
`sentry.edge.config.ts`, `instrumentation-client.ts` and `instrumentation.ts` are deleted;
`next.config.ts` exports the plain config instead of `withSentryConfig`; `SENTRY_DSN` is out of
`lib/env.ts`, `scripts/check-env.mjs` and `.env.example`; and the four `Sentry.capture*` call sites
(`lib/safe-action.ts`, `lib/jobs/runner.ts`, `lib/jobs/handlers/inventory.reconcile.ts`,
`app/(app)/error.tsx`) are removed. Recorded as ADR-018 in `architecture.md` §15.

**Where an error goes now — nothing silently swallows one.** A failed job still writes its message
to `jobs.last_error` through `rpc_finish_job`, which is what the Admin ops page reads and what
`inventory.reconcile`'s deliberate throw relies on; that path is untouched. An unmapped Server
Action error is now `console.error`-ed with the same `request_id` the user is shown, which is new —
`mapDomainError` previously handed the error to Sentry and to nothing else, so removing the call
without replacing it would have made the reference id the user quotes unfindable. `app/(app)/error.tsx`
adds no logging of its own: React already logs a client error to the console, and a server error is
logged by Next.js with the `digest` the page displays.

**Consequence — recorded, not hidden.** There is no error aggregation, no error-rate alert (that row
is removed from `architecture.md` §9.2 rather than left as a promise nothing keeps), no release
tagging and no source-map upload, so a production stack trace reads against the deployed bundle.
This is a real loss of a signal — it is affordable only because the signal was never actually
switched on.

**Kept deliberately:** `lib/observability/redact.ts` and its 11 tests. It has no caller now — the
Sentry `beforeSend` hooks were its only ones — but `architecture.md` §6.4's "never a monetary value
in logs or analytics" is a data-classification control that outlives any one sink, and
`build/10-hardening-and-launch.md` §2.4 still requires the redaction test to exist. Deleting it
would mean rewriting it the day an error sink of any kind is added.

**Not touched:** `docs/build/01…09` are the dated record of how the system was built and still
describe wiring Sentry. They are history, not instructions, and are left as written — as is
`01-hld.md` §17's Phase 0 plan, which also still says "Next.js 15" and "shadcn". The one exception
is `build/10-hardening-and-launch.md`: it is a to-do list nobody has worked through yet, so its
Sentry setup and go-live checklist items would have been read as instructions. Those are struck
out or removed; its redaction-test requirement stays, now worded without a vendor.

---

## Still open

| Item | Owner | Blocks | Raised |
|---|---|---|---|
| **Apex Studios' legal identity — ON HOLD at Voola's request (2026-09-10).** legal_name, GSTIN, PAN and registered address are placeholders in the seed. `pnpm check:release` reports it; it is a hard gate on any production deploy, and deliberately not a failing unit test, because development is not blocked by it. | Voola | First real bill (Build 09), production deploy | 2026-09-10 |
| CA confirmation: material-at-site as secured advance (D4) | Voola → CA | First real bill | 2026-09-09 |
| CA confirmation: statutory retention period (A-5) | Voola → CA | Build 10 R2 lifecycle rules | 2026-09-09 |
| CA sign-off: the five tax questions in `01-hld.md` §8.4 | Voola → CA | Build 09 go-live | 2026-09-09 |
| DPDP Act 2023 obligation set (`architecture.md` §12) | Voola → counsel | Launch | 2026-09-09 |
| **No real past Apex RA bill was ever supplied** (build/09-billing.md §0.2's own prerequisite: "a real past RA bill, GST invoice sample, and the CA's five confirmed answers"). The build's own exit criterion — "reproduce a real past bill from seeded equivalents and assert every figure matches the document a human already checked" — could not be attempted; there is nothing to reproduce against. `BillDocument.tsx`'s layout is therefore a reasonable placeholder, not a copy of a real Apex bill. | Voola | Build 09's golden-file exit criterion; confidence the PDF layout matches what Apex actually sends clients | 2026-09-11 |
| **CA sign-off on a generated RA bill PDF** — Build 09's own exit criterion ("a CA has reviewed a generated RA bill PDF and signed off in writing") is outside what this work can obtain on its own. | Voola → CA | Build 09 go-live, alongside D4/D45/D46 and the five §8.4 tax questions | 2026-09-11 |
| CGST/SGST split vs. one blended `gst_amount` (D45) | Voola → CA | First real bill if Apex bills inter-state | 2026-09-11 |
| Retention release schedule — none implemented (D46) | Voola | Future scope, not Build 09 | 2026-09-11 |
| ~~No TOTP enrollment UI exists (D22) — an owner/admin account cannot pass `requireAalForRole`'s AAL2 check anywhere outside the dev-only workaround in `e2e/global-setup.ts`. Every `adminAction`-guarded Server Action is unreachable by a real admin user until this is built.~~ **Resolved 2026-09-17 by D48** (two-factor requirement removed). | — | Any real admin using a real account | 2026-09-10 |
| **Cloudflare R2 is live and the upload pipeline works end to end — one security gap remains.** Supersedes the original "no R2 account" blocker; re-verified 2026-09-16 against the real account. **Working:** app bucket `HeadBucket` plus a full presigned **PUT → GET → DELETE**; **CORS configured** (preflight returns 204 with a matching `Access-Control-Allow-Origin` for both `localhost:3000` and the deployed origin), so real browser uploads are unblocked; the backup-bucket read grant now works (`backup.verify`'s own `HeadObject` returns **404 not 403** — it can read the bucket, there is simply no dump yet, which is correct until `backup.nightly` first succeeds); and a genuinely generated bill PDF is present in the app bucket, so the `bill.pdf` job has run for real. **Open — the app token is over-privileged on the backup bucket.** A probe `PutObject` *succeeded*, and so did deleting it. `.env.example` and D17 both require this credential be **read-only** there, precisely so a compromised app token cannot destroy the only recovery point; the write-scoped pair belongs solely to `.github/workflows/backup-nightly.yml`. Fix in Cloudflare: scope the app token to Object Read **& Write** on `apex-studios` but Object **Read-only** on `apex-backups`. Still unverified: a real browser PUT from a live page, thumbnail generation and its EXIF-absence check, the orphan sweep actually deleting, and the GitHub Actions backup write. | Voola | The read-only regrant — a compromised app credential can currently wipe the backups | 2026-09-16 |
| ~~**Vercel is not on Pro** — the per-minute `jobs.drain` does not run without it.~~ **Resolved 2026-09-16 by D47**, and the original wording was wrong about the limit: Hobby allows 100 crons, capped at *one invocation per day each*. `jobs.drain` and `jobs.reap` now run from GitHub Actions; the three daily/weekly crons stayed on Vercel. Still unverified **live** — the drain has never been observed draining a real queue in production, because production is four builds behind and the Vercel env vars below are still unset. | Voola | Live verification of the drain, once production deploys | 2026-09-12 |
| **Vercel is still not on Pro, for the reasons D47 did *not* resolve.** ADR-016 also bought Supabase PITR (RPO 24 h → 15 min) and, more pressingly, Hobby's terms **forbid commercial use** — this system issues GST tax invoices. Cron was only one of three justifications and is now handled without paying; these two are not. | Voola | Production go-live (licensing), `architecture.md` §7.2's stated RPO | 2026-09-16 |
| **`.env.local` now holds real values; Vercel and GitHub Actions still hold none.** As of 2026-09-16 the local file has real Supabase, R2 and `CRON_SECRET`/`SESSION_SECRET` values (verified by shape and by the live R2 and `select 1` probes above) — the Build 01 placeholders are gone. What is still missing is everywhere *else*. **Vercel Production + Preview** need: `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_BACKUP_BUCKET`, `CRON_SECRET`, `SESSION_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SITE_URL` (the deployed URL, **not** the local `localhost:3000`; it must also be allow-listed in Supabase's Redirect URLs). `BILLING_ENABLED` should be `false` in production — it is `true` locally for testing. Until these exist, `next build` on Vercel dies in `lib/env.ts`'s eager zod parse before it compiles a page, which is the whole reason Vercel deployments fail. **GitHub Actions repo secrets** for `.github/workflows/backup-nightly.yml` need: `SUPABASE_DB_URL`, `R2_ACCOUNT_ID`, `R2_BACKUP_BUCKET`, `R2_BACKUP_ACCESS_KEY_ID`/`R2_BACKUP_SECRET_ACCESS_KEY` (the **write**-scoped pair, distinct from the app's read-only one), `APP_URL`, and the same `CRON_SECRET` as Vercel's. As of 2026-09-16 only `CRON_SECRET`, `SUPABASE_DB_URL`, `SUPABASE_PROD_PROJECT_REF` and the two `NEXT_PUBLIC_SUPABASE_*` keys exist — so the nightly backup is currently failing at its upload step. **`APP_URL` is now needed by the two D47 cron workflows as well**, and without it `jobs-drain.yml` and `jobs-reap.yml` fail fast with a named-but-unprinted secret error on every tick. | Voola | Vercel deployments; the nightly backup ever running; the D47 cron workflows | 2026-09-16 |
