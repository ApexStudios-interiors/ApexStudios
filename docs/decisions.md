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

## Still open

| Item | Owner | Blocks | Raised |
|---|---|---|---|
| **Apex Studios' legal identity — ON HOLD at Voola's request (2026-09-10).** legal_name, GSTIN, PAN and registered address are placeholders in the seed. `pnpm check:release` reports it; it is a hard gate on any production deploy, and deliberately not a failing unit test, because development is not blocked by it. | Voola | First real bill (Build 09), production deploy | 2026-09-10 |
| CA confirmation: material-at-site as secured advance (D4) | Voola → CA | First real bill | 2026-09-09 |
| CA confirmation: statutory retention period (A-5) | Voola → CA | Build 10 R2 lifecycle rules | 2026-09-09 |
| CA sign-off: the five tax questions in `01-hld.md` §8.4 | Voola → CA | Build 09 go-live | 2026-09-09 |
| DPDP Act 2023 obligation set (`architecture.md` §12) | Voola → counsel | Launch | 2026-09-09 |
| No TOTP enrollment UI exists (D22) — an owner/admin account cannot pass `requireAalForRole`'s AAL2 check anywhere outside the dev-only workaround in `e2e/global-setup.ts`. Every `adminAction`-guarded Server Action is unreachable by a real admin user until this is built. | — | Any real admin using a real account | 2026-09-10 |
