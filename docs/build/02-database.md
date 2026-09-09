# Build 02 — Database: Schema, RLS, Column Isolation, Seed & pgTAP

> **This file is a prompt.** `02-lld.md` is the contract; this file is the order of operations.
> Where they differ on a column name or a policy, **the LLD wins and you fix this file**.
>
> **Depends on:** Build 01 complete; decisions D2, D3, D6, D8, D11 answered.
> **Blocks:** every feature build (03–09).
> **Branch:** `build/02-database`

This is the most consequential build file in the set. Everything the product promises about
who sees what is decided here, and schema is the one thing that does not roll back.

---

## 0. Prerequisites — what a human must do outside the codebase

- [ ] **Decisions answered** in `docs/decisions.md`, not assumed:
      **D8** (is there an `owner` role — changes the `app_role` enum),
      **D3** (single-org — `org_id` still goes on every table either way),
      **D2** (simple inventory — no cost layers on `stock_movements` yet),
      **D6** (bills are per-project, numbered `RA-{code}-{n}`),
      **D11** (data access path — determines whether the views or Drizzle are load-bearing).
      If D8 is `PENDING`, **stop.** The enum is in migration 0001 and enum values cannot be
      removed later.
- [ ] **Apex Studios' legal identity** for the `orgs` seed row: legal name, GSTIN, PAN,
      registered address. Placeholders here become placeholders on a tax invoice.
- [ ] **Project code convention** confirmed with Voola. `BHEL-NCH` is the prototype's. Codes
      appear in bill numbers forever and `projects.code` is unique per org — a bad convention
      is permanent. Confirm max length, allowed characters, and who assigns them.
- [ ] **Default billing constants** confirmed as *defaults*, not truths: GST 18, retention 5,
      MAS 75, TDS 0. These are per-project columns; the defaults only matter for new projects.
      (The values themselves are CA-gated in Build 09 — that gate is downstream, not here.)
- [ ] **Real inventory unit list** from Apex (`bag`, `sqft`, `nos`, `kg`, `ltr`, …). Used for
      seed realism and for the unit dropdown in Build 07.
- [ ] **`apex-dev` Supabase project reachable**, and `DATABASE_URL` in `.env.local`.
- [ ] **Docker running** — `pnpm supabase start` must work before you begin.

---

## 1. Objective

A complete, migrated, RLS-enforced schema with:
- every table locked down in the same migration that creates it,
- column isolation proven to work for a real client session,
- a seed dataset that reproduces the prototype so the UI keeps rendering,
- and a pgTAP suite that fails if any of that regresses.

No application code changes in this build. No UI changes.

---

## 2. Step zero — the spike that must happen before any table is written

**Do this first. It can invalidate the whole column-isolation design.**

`02-lld.md` §6 requires `alter table … force row level security` on every table.
`02-lld.md` §4.3 implements column isolation as `security definer` views
(`with (security_invoker = off)`) that read those same tables.

`force row level security` makes RLS apply to the table's **owner** as well. A security-definer
view executes as the view's owner. If the view owner is subject to the base table's RLS
policies, then `v_package_client` — which must return rows to a *client* session — will be
evaluated against `packages_select_admin` (`using (is_admin())`) and return **zero rows**.
The client's Packages table would silently render empty.

Write a throwaway migration and a throwaway pgTAP test that proves the behaviour end to end:

1. Create `spike_costs(id, project_id, public_val numeric, secret_val numeric)`.
2. `enable row level security`, `force row level security`, one policy: `using (public.is_admin())`.
3. Create `v_spike_client with (security_invoker = off) as select id, project_id, public_val from spike_costs where public.is_member_of(project_id)`.
4. `grant select on v_spike_client to authenticated`.
5. From a **client SDK session** (not the SQL editor — it bypasses RLS and will lie to you):
   - `select * from v_spike_client` → **must return the row**
   - `select secret_val from spike_costs` → **must error or return nothing**

Record the result in `docs/decisions.md` as **D14**.

- **If the view returns rows:** proceed exactly as the LLD specifies.
- **If the view returns nothing:** the LLD's design needs one of these amendments, in order of
  preference. Pick one, write it into `02-lld.md` §4.3, and say so in the PR:
  1. Grant the view's owner `bypassrls`, or own the views with a role that has it.
  2. Drop `force row level security` on the six cost-bearing tables only
     (`packages`, `phases`, `bills`, `bill_lines`, `inventory_items`, `stock_requests`),
     keeping it everywhere else. Document precisely what that gives up: RLS no longer applies
     to the table owner, which matters only for direct owner-role connections — which, under
     D11 option (A), the application never opens.
  3. Replace definer views with **column-level `GRANT`s**:
     `revoke select on packages from authenticated;`
     `grant select (id, project_id, seq_no, name, allocated_amount, status, progress_pct) on packages to authenticated;`
     This makes `select internal_amount` a hard permission error, which is exactly what
     `02-lld.md` §6.3 test 1 asks for. Its limitation is that grants are per *database* role and
     all app users share `authenticated`, so it cannot distinguish client from site — you would
     still need views for that distinction, layered on top.

Delete the spike migration before merging. Keep its pgTAP test, retargeted at `packages`.

---

## 3. Migration order

One concern per file. Every file that creates a table also enables RLS, adds `force`, adds its
policies, and adds an index for every column named in a policy — **in the same file**. This is
`AGENTS.md` database rule 2 and it has no exceptions, including for lookup tables.

| # | File | Contents |
|---|---|---|
| 0001 | `extensions_and_enums` | `pgcrypto`; all eleven enums from `02-lld.md` §2 plus `job_status` |
| 0002 | `helpers` | `fn_money`, `auth_role`, `auth_org`, `is_admin`, `is_member_of`, `fn_audit`, `trg_set_updated_at` |
| 0003 | `orgs_profiles_clients` | §3.1 + policies |
| 0004 | `projects_members` | §3.2 + policies + membership indexes |
| 0005 | `packages_phases_tasks` | §3.3 + policies (admin-only select on packages/phases) |
| 0006 | `inventory_and_movements` | §3.4 + append-only `stock_movements` |
| 0007 | `stock_requests` | §3.5 + events + the partial billable index |
| 0008 | `approvals` | §3.6 |
| 0009 | `daily_updates` | §3.7 + the 24-hour author edit policy |
| 0010 | `bills` | §3.8 — bills, bill_lines, bill_events, payments |
| 0011 | `attachments_and_audit` | §3.9 — append-only `audit_log` |
| 0012 | `jobs` | §3.10 + `rpc_claim_jobs` + `rpc_finish_job` |
| 0013 | `views_rollups` | `v_package_rollup`, `v_phase_billing`, `v_inventory_status` |
| 0014 | `views_role_scoped` | `v_package_client`, `v_package_site`, `v_phase_client`, `v_bill_client`, `v_inventory_site`, `v_stock_request_site` |
| 0015 | `views_billable_and_notifications` | `fn_cost_to_client_factor`, `v_billable_now`, `v_notifications` |
| 0016 | `triggers_rollup` | `trg_tasks_after_update` → package + project `progress_pct` |

Domain RPCs (`rpc_transition_stock_request`, `rpc_create_bill`, `rpc_transition_bill`,
`rpc_decide_approval`, `rpc_set_task_progress`, `rpc_adjust_inventory`, `rpc_record_payment`)
are **not** written here. They ship in the build file that owns their feature, so their
integration tests land in the same PR. Migration 0012 establishes the pattern; the rest follow it.

Name files as the Supabase CLI does: `pnpm db:migration <name>` produces
`supabase/migrations/<timestamp>_<name>.sql`. Never rename or edit an applied file.

---

## 4. Steps

### 4.1 Enums (0001)

Copy `02-lld.md` §2 verbatim. Two notes:

- `app_role` includes `'owner'` **only if D8 is yes.** Values cannot be dropped from a Postgres
  enum, so guessing costs a table rewrite later.
- `phase_billing_status` has four values (`unresolved`, `billable`, `billed`, `paid`), while the
  UI's `phStatus()` in `lib/logic.ts` computes `Pending | Billable | Billed | Paid`. Map
  `unresolved → "Pending"` at the presentation layer in Build 04. Do not rename the enum to
  match the UI string.

### 4.2 Helper functions (0002)

All of `02-lld.md` §5.1, exactly as written: `language sql`, `stable`, `security definer`,
`set search_path = ''`.

`set search_path = ''` is not stylistic. A `security definer` function without it is a privilege
escalation: a caller can create a schema earlier in their search path and shadow a table name.
Every function in this build has it, and the pgTAP suite asserts it (§6.6).

Add:
- `fn_money(numeric) returns numeric(14,2)` — `round(v, 2)`, half-up (`02-lld.md` §1.4).
- `fn_audit(entity_type text, entity_id uuid, action text, before jsonb, after jsonb)` — inserts
  into `audit_log` reading `auth.uid()` and `auth_role()`. Called from inside every mutating
  RPC, in the same transaction as the change.
- `trg_set_updated_at()` — a single shared trigger function, attached by every table.

Keep the `coalesce(jwt claim, table lookup)` fallback in `auth_role()` and `auth_org()`. It is
what makes a misconfigured auth hook degrade to slow rather than to insecure
(`architecture.md` §8.4).

### 4.3 Tables (0003–0012)

Transcribe `02-lld.md` §3 faithfully. The following are the places where transcription errors
are expensive — check each one explicitly:

1. **Money is `numeric(14,2)`, quantity `numeric(14,3)`, percentage `numeric(6,3)`.**
   Grep the finished migrations for `float`, `real`, `double precision`, `money`. Zero hits.
2. **Every business table carries the eight standard columns** from `02-lld.md` §1.3, including
   `org_id` (D3) and `deleted_at`.
3. **`stock_requests.billed_on_bill_id` references `bills(id)`**, but `bills` is created in 0010
   and `stock_requests` in 0007. Either move the foreign key into 0010 as an
   `alter table … add constraint`, or reorder. Do not drop the constraint — it is the
   double-billing guard's other half.
4. **`tasks.end_date` is a generated stored column**: `start_date + (duration_weeks * 7) - 1`.
   Do not compute it in application code (ADR-011).
5. **`tasks` denormalises `project_id` and `package_id`.** That is deliberate — RLS policies
   evaluate against an indexed local column instead of a two-join lateral. Keep them, and add a
   trigger or a check that they stay consistent with `phase_id`'s ancestry.
6. **`inventory_items.project_id` is nullable** — `NULL` means the central store.
   `unique nulls not distinct (org_id, project_id, sku)` requires Postgres 15+. Verify the local
   and production major versions match before relying on it.
7. **`ap_decided_ck`** on approvals: `(status = 'pending') = (decided_at is null)`. This makes
   "decided but no timestamp" unrepresentable. Constraints like this are cheaper than the tests
   that would otherwise catch the bug.
8. **`sr_reject_ck`** and the equivalent on approvals make a rejection reason mandatory at the
   database, not just in the RPC.
9. **`idx_bill_lines_source`** — the unique partial index on `(source_type, source_id)` is the
   double-billing guard. It must be `unique`, and it must be `where source_id is not null`.
10. **`idx_sr_billable`** — the partial index on delivered-and-unbilled requests is what makes
    Billable Now fast. It indexes exactly the rows that query wants and nothing else.
11. **`jobs_idem_uq`** — `unique nulls not distinct (name, idempotency_key)`.

### 4.4 RLS policies

Follow the matrix in `02-lld.md` §6.1 exactly. Read it as three distinct patterns:

- **Member-scoped tables** (`tasks`, `approvals`, `daily_updates`, `attachments`, `projects`) —
  `using (deleted_at is null and public.is_member_of(project_id))`.
- **Admin-only tables** (`packages`, `phases`, `bills`, `bill_lines`, `stock_requests`,
  `inventory_items`) — these carry cost columns. `select` is granted **only** to `is_admin()`.
  Non-admins reach them through the role-scoped views in 0014 and nowhere else.
- **RPC-only tables** (`stock_movements`, `audit_log`, and the update path on bills/requests) —
  **no policy grants the operation to `authenticated` at all.** The `security definer` function
  is the sole way in. This is what stops a direct PostgREST call from bypassing the business
  rules in `02-lld.md` §5, even for an authenticated Admin.

Three rules while writing them:

- **`force row level security` on every table** (subject to the §2 spike result).
- **Index every column named in a policy.** Unindexed policy predicates are the single biggest
  cause of Supabase performance collapse (`AGENTS.md` database rule 5). After writing 0003–0012,
  run the check in §6.5 and make it part of CI.
- **Wrap policy function calls so they are evaluated once, not per row** where the planner
  allows it — `using ((select public.is_admin()))`. Measure with `explain analyze` on a table
  seeded to 10k rows before deciding it matters; do not cargo-cult it.

`stock_movements` and `audit_log` get **no** update or delete policy for **any** role, including
`owner` (ADR-007). If someone later asks for a "fix a typo" path, the answer is a compensating
row, and this file is the reason.

### 4.5 Views (0013–0015)

Transcribe `02-lld.md` §4. Two corrections to make while transcribing:

- `v_phase_billing` groups by `ph.id` while selecting `ph.project_id`, `ph.package_id`,
  `ph.name`, etc. That works in Postgres only because `ph.id` is the primary key — functional
  dependency. It is legal; leave it, but do not copy the pattern to a non-PK grouping.
- `v_billable_now`'s material branch calls `fn_cost_to_client_factor` per row. Confirm with
  `explain analyze` against seeded data that this is not quadratic. If it is, materialise the
  factor per phase in a CTE.

For the role-scoped views (0014), the rule from `02-lld.md` §4.3 is absolute:

> **If a column would be a permission violation for that role, it does not appear in the
> view's select list.** Not null. Not zero. Absent.

Write `v_package_client`, `v_package_site`, `v_phase_client`, `v_bill_client`,
`v_inventory_site`, `v_stock_request_site`. `grant select` on each to `authenticated`; the
`where public.is_member_of(...)` clause inside the view is the row guard.

Add a comment above each view naming the columns deliberately omitted and why:
```sql
-- v_package_client: omits internal_amount, committed, remaining, used_pct, margin.
-- Adding any of them here is a client-visible margin leak. See 01-hld.md §7 Layer 2.
```

### 4.6 The progress rollup trigger (0016)

`after insert or update or delete on tasks` → recompute `packages.progress_pct` as the
duration-weighted mean of task progress, then `projects.progress_pct` as the
allocated-weighted mean of package progress (`01-hld.md` §5.3).

Cached rather than computed because the portfolio page renders every project's packages, and a
weighted mean over every task on every portfolio load does not survive twenty projects.

Two things to get right:
- The trigger must be **idempotent and re-entrant safe** — it updates `packages`, which has its
  own `updated_at` trigger. Confirm no recursion.
- It must not fire on `deleted_at` changes in a way that double-counts. Filter soft-deleted rows
  in the aggregate, and test it (§6.4).

Flipping `phases.billing_status` to `billable` when all tasks reach 100% belongs to
`rpc_set_task_progress` in Build 05, not to this trigger — a status with commercial meaning
should be set by an audited, explicit call.

### 4.7 Jobs infrastructure (0012)

The `jobs` table, `rpc_claim_jobs` and `rpc_finish_job` from `02-lld.md` §3.10, verbatim.
The runner, the cron routes and the handlers are Build 06. Landing the table now means Build 06
starts with the concurrency primitive already tested.

`for update skip locked` inside `rpc_claim_jobs` is the entire concurrency story: two
overlapping cron ticks skip each other's rows instead of blocking or double-running. Test it in
§6.4 before anything depends on it.

RLS on `jobs`: `select` for `is_admin()` only; **no** insert, update or delete policy for any
role. Enqueue and claim are both `security definer`. A user cannot schedule work.

### 4.8 Drizzle schema and generated types

1. Write `db/schema/*.ts` mirroring the migrations — one file per migration group.
2. `pnpm db:types` to generate `db/types.ts` from the local database.
3. `pnpm db:check-drift` must pass. Wire it into CI as a blocking step: a Drizzle schema that
   has drifted from the SQL produces types that lie, and a type that lies is worse than no type.
4. Under D11 option (A), Drizzle is used for schema and for `service_role` job queries only.
   Add a header comment to `db/index.ts` stating that, and confirm the ESLint restriction from
   Build 01 §3.11 covers it.

### 4.9 Seed data

`supabase/seed.sql`, translating `docs/reference/prototype-dataset.ts` per `02-lld.md` §11.

Requirements:
- **Fixed UUIDs**, declared as SQL constants at the top of the file, so e2e tests and pgTAP can
  reference rows by id. Randomly generated seed ids make every test flaky.
- **Idempotent** — `on conflict do nothing` throughout, so `db:reset` and a re-run behave the same.
- Full coverage of the states the UI renders, or pages will look broken in development:
  - one org (real Apex legal details), one client, one project `BHEL-NCH`
  - profiles: one `owner`, three `admin`, one `site`, one `client`, with `project_members` rows
    for the site and client users only (admins are implicit — `02-lld.md` §3.2)
  - four packages with the prototype's exact allocated/internal figures, their phases, and tasks
    at varied progress — **including at least one phase with every task at 100%**, or Billable
    Now is empty and Build 09 has nothing to develop against
  - stock requests in **all five** statuses
  - approvals: pending, approved, rejected
  - bills: one each of draft, submitted, certified, paid
  - inventory covering all three derived statuses (`qty = 0`, `0 < qty < reorder`, `qty ≥ reorder`)
- **Task dates, not week integers.** The prototype stores `w: 3, d: 2`. Convert:
  `start_date = project.start_date + (w - 1) * 7`, `duration_weeks = d`. Record the conversion in
  a comment — Build 05 depends on it.
- **Money values transcribed exactly** from the prototype. They are the reference for the
  visual-parity check in Build 04.
- A header comment: *"Demo dataset. Contains no real client data beyond Apex's own legal
  details. Never load into production."*

### 4.10 CI: make the database stages blocking

Extend `.github/workflows/ci.yml` after the unit-test stage:

```
supabase start
  → supabase db reset            (migrations + seed, from scratch, every run)
  → pgTAP RLS suite              ◄── BLOCKING. No continue-on-error. Ever.
  → drizzle drift check
  → integration tests
```

`architecture.md` §10.1 makes the RLS stage blocking by policy. Put that sentence in the
workflow file as a comment so the next person to hit a red build reads the reason before
reaching for `continue-on-error`.

---

## 5. Tests to write

The RLS suite is the highest-value test code in this repository. It is also the only thing
standing between a live PostgREST endpoint and every number in the business.

### 5.1 pgTAP — the required set

Implement all seven assertions from `02-lld.md` §6.3, for each of `owner`, `admin`, `site`,
`client`, and for a member versus a non-member of a project:

| ID | Assertion |
|---|---|
| T-11 | A client session selecting `packages.internal_amount` returns **nothing or errors**. Not null. Not zero. |
| T-12 | A site session selecting any row from `bills` returns nothing |
| T-13 | A site user reading a project they are not a member of gets zero rows |
| T-14a | **No role** can `insert into stock_movements` |
| T-14b | **No role, including `owner`,** can `update` or `delete` `audit_log` |
| — | A client session **can** read `v_package_client` and sees `allocated_amount` |
| — | A site session **can** read `v_package_site` and the result set contains no money column |

The last two are the positive controls. A suite of only negative assertions passes perfectly
against a database where nobody can read anything.

**Every one of these runs from a client SDK session with a real JWT.** Not `supabase db execute`,
not the SQL editor, not a `postgres`-role connection — those bypass RLS and will report a broken
policy as working (`AGENTS.md` database rule 8). Build a small helper,
`supabase/tests/helpers.sql` plus a TypeScript `asRole(role, projectId)` fixture, and use it
everywhere.

### 5.2 Structural pgTAP assertions

Cheap, and they catch the failure mode where a future migration forgets a rule:

- Every table in `public` has `relrowsecurity` **and** `relforcerowsecurity` set.
- Every table in `public` has at least one policy.
- Every column appearing in a policy expression has an index.
- Every `security definer` function has `search_path = ''` set.
- No column in `public` has type `float4`, `float8`, or `money`.

These five run over the catalogue, not over a list you maintain, so they keep working as tables
are added in Builds 05–09.

### 5.3 Integration tests (Vitest, against local Supabase)

| ID | Assertion |
|---|---|
| T-21 | Two concurrent `rpc_claim_jobs` calls never return the same row |
| T-24 | Enqueuing the same `(name, idempotency_key)` twice creates one row |
| — | `trg_tasks_after_update` recomputes package and project `progress_pct` correctly |
| T-16 | Duration weighting: a 3-week task at 100% plus a 1-week task at 0% → **75%** |
| — | Soft-deleted tasks are excluded from the rollup |
| — | Inserting a negative `qty_on_hand` is rejected by the check constraint |
| — | `idx_bill_lines_source` rejects a second line for the same `(source_type, source_id)` |

### 5.4 Verify the seed

A test that runs `db:reset` and asserts the invariants Build 04–09 will rely on: five stock
request statuses present, four bill statuses present, at least one phase fully complete, and at
least one inventory item in each of the three derived states. A seed that quietly loses its
"one complete phase" makes Build 09 look broken for a day.

---

## 6. Verification — exit criteria

```bash
pnpm db:reset                    # migrations + seed, from empty, no errors
pnpm test:rls                    # pgTAP — all green, and the suite is non-empty
pnpm test                        # integration tests green
pnpm db:check-drift              # Drizzle matches SQL
pnpm typecheck && pnpm lint && pnpm build
pnpm dev                         # UI still renders identically — it is still on AppContext
```

Manual checks:
- [ ] The §2 spike result is recorded as D14 in `docs/decisions.md`, and if it forced a design
      change, `02-lld.md` §4.3 has been amended and the amendment is called out in the PR.
- [ ] Sign in to the local Supabase Studio **as a client user** (not the SQL editor) and try to
      read `packages`. Confirm with your own eyes that it fails.
- [ ] `grep -riE '\b(float|real|double precision|money)\b' supabase/migrations/` → no type hits.
- [ ] Every migration that creates a table contains `enable row level security` and at least one
      `create policy` in the same file. Check by reading, then by the §5.2 test.
- [ ] `explain analyze` on the three hot queries (portfolio packages, Billable Now, notifications)
      shows index scans, not sequential scans, against a 10k-row seeded database.
- [ ] `docs/progress-tracker.md` updated.

---

## 7. Guardrails — do not

- **Do not change schema through the Supabase dashboard.** Ever, in any environment. The
  migration file is the source of truth and a dashboard change is invisible to every other
  environment (`AGENTS.md` database rule 1).
- **Do not edit an applied migration.** Fix it forward with a new one.
- **Do not test RLS from the SQL editor.** It bypasses RLS. It will tell you a broken policy works.
- **Do not add an update or delete policy** to `stock_movements`, `audit_log` or `bill_events`,
  for any role, for any reason, including "just for the seed script".
- **Do not use a floating-point type for money or quantity.**
- **Do not skip the index on a policy column** because the table is small today.
- **Do not write the domain RPCs here.** They belong with their feature and their tests.
- **Do not touch `context/AppContext.tsx`, `lib/data.ts`, or any component.** The UI runs on the
  prototype's in-memory data until Build 04 starts replacing it page by page.
- **Do not put real client data in `seed.sql`** beyond Apex's own legal details.

---

## 8. Deliverables

- [ ] Migrations 0001–0016, each self-contained, each with RLS and policies inline
- [ ] The §2 spike run, resolved, recorded as D14, and its migration deleted
- [ ] Helper functions with `search_path = ''`
- [ ] Rollup, role-scoped, Billable Now and notification views, each with an omission comment
- [ ] Progress rollup trigger
- [ ] `jobs` table + `rpc_claim_jobs` + `rpc_finish_job`
- [ ] Drizzle schema, generated types, drift check in CI
- [ ] `supabase/seed.sql` — fixed UUIDs, idempotent, full state coverage
- [ ] pgTAP suite: seven required assertions × five role/membership cases, plus the five
      structural assertions
- [ ] Integration tests T-16, T-21, T-24 and the constraint tests
- [ ] CI with `db reset` + pgTAP as a blocking stage
- [ ] `docs/progress-tracker.md` updated; `02-lld.md` amended if the spike required it
