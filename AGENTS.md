<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

Operating instructions for AI coding agents working in this repository.
Place at the repo root. Read `docs/01-hld.md` and `docs/02-lld.md` before non-trivial work.

## Documentation map

Everything lives in `docs/`. Precedence when two documents disagree is set out in
`docs/ai-workflow-rules.md` §1.

| File                        | What it decides                                                       |
| --------------------------- | --------------------------------------------------------------------- |
| `AGENTS.md` (this)          | The hard rules. Not advisory. Wins always.                            |
| `docs/01-hld.md`            | Product intent, flows, business rules, open decisions §18             |
| `docs/02-lld.md`            | Schema, RLS policies, RPCs, route tree — the implementation contract  |
| `docs/architecture.md`      | Production topology, environments, CI, failure modes, ADR log         |
| `docs/ui-guide.md`          | What is on screen and what each role can do. **The functional spec.** |
| `docs/code-standards.md`    | Conventions that would otherwise be re-litigated every review         |
| `docs/ai-workflow-rules.md` | How an agent works through this repository                            |
| `docs/decisions.md`         | Answered decisions. A recommendation is not an answer.                |
| `docs/build/01…10`          | The build sequence. One file, one branch, one PR.                     |
| `docs/progress-tracker.md`  | Where the build has got to, and what is blocked                       |
| `docs/reference/`           | The frozen prototype dataset and the original mockup                  |

---

## What this is

**Apex Projects** — the internal operations platform for Apex Studios, an interiors and
construction contractor in India. It tracks client projects broken into packages → phases →
tasks, manages material flow and inventory, collects client sign-off on samples and
drawings, and generates GST-compliant RA (Running Account) bills.

Three roles with genuinely different data visibility: **Admin**, **Site Supervisor**,
**Client**.

### The one rule that matters most

> **Only Admin ever sees internal cost or margin.**
> Clients see `allocated_amount` (what they're charged). Site Supervisors see no money at
> all. This is enforced in the database (RLS + column-omitting views), in the API layer, and
> by never fetching the column in the first place.

If a change you are making would put `internal_amount`, `unit_cost`, `rate`,
`internal_cost_amount` or `margin_amount` into a response that a non-Admin session could
receive, **stop and flag it**. Do not "fix" it by hiding the value in the UI.

---

## Setup

```bash
pnpm install
cp .env.example .env.local            # fill in Supabase + R2 credentials
pnpm env:check                        # every key present and well-formed
pnpm db:link                          # link the apex-dev project (ap-south-1)
pnpm db:push                          # apply migrations to it
pnpm dev                              # http://localhost:3000
```

**There is no Docker and no local database (D14).** Development runs against the
hosted `apex-dev` project, so every query is a round trip to Mumbai and there is
no offline mode. `apex-dev` is shared: destructive experiments belong on a
pull request's Supabase preview branch, not on it.

`pnpm db:reset` drops and re-seeds the **linked** project. It refuses to run
against `SUPABASE_PROD_PROJECT_REF` and makes you type the ref back. Seeded
logins are printed by it; there is one account per role.

## Commands

| Command                    | What it does                                               |
| -------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                 | Next.js dev server                                         |
| `pnpm build`               | Production build — must pass before any PR                 |
| `pnpm typecheck`           | `tsc --noEmit`, strict mode                                |
| `pnpm lint`                | ESLint + Prettier check                                    |
| `pnpm test`                | Vitest unit + integration                                  |
| `pnpm test:rls`            | pgTAP policy tests against the linked or preview database  |
| `pnpm test:e2e`            | Playwright, all three role journeys                        |
| `pnpm db:reset`            | Drop, re-migrate, re-seed the **linked** project. Guarded. |
| `pnpm db:push`             | Apply pending migrations to the linked project             |
| `pnpm db:migration <name>` | Scaffold a new timestamped migration file                  |
| `pnpm db:types`            | Regenerate Drizzle/Supabase types from the local schema    |

Before opening a PR: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:rls && pnpm build`.

---

## Stack

- **Next.js 16** App Router, React Server Components, **React 19**, TypeScript **strict**
- **Tailwind CSS v4** + **hand-rolled primitives in `components/ui/` — not shadcn/ui**
- **Supabase** Postgres (datastore + auth), accessed through the Supabase client — see
  **Data access** below
- **Drizzle** for schema definition, migrations, generated types and `service_role` job handlers
- **Cloudflare R2** — one private bucket, presigned URLs only
- **Vercel Cron** + a `jobs` table in Postgres — background work. No third-party job runner.
- **Sentry** (errors). Email notification is **out of scope for v1**.
- `zod`, `react-hook-form`, `next-safe-action`, TanStack Table, Recharts
- `@react-pdf/renderer` (bill PDFs), `exceljs` (Admin exports)
- **pnpm**, Node >= 20, lockfile committed, CI installs `--frozen-lockfile` (D12)

> **The UI is complete and it is the functional specification.** Do not restyle, do not swap the
> component library, do not introduce a design system. Changes to `components/ui/` require a
> stated reason in the PR. `docs/ui-guide.md` is the spec; the screenshots under
> `e2e/__screenshots__/proto-v1/` are the visual baseline.

There is **no separate Node.js backend service**. Next.js Server Actions and Route Handlers
are the backend. See HLD §4.2 for why, and for the conditions under which we'd add one.

---

## Data access — the D11 rule

**User-facing reads and writes go through the Supabase server client bound to the user's JWT**
(`@supabase/ssr`). PostgREST runs the query as `authenticated` with the user's claims, so RLS
applies automatically and the safe path is the only path.

**Drizzle is for schema definition, migration generation, generated types, and queries inside
`lib/jobs/handlers/**` that legitimately run as `service_role`.**

> **A Drizzle query in a request path is an RLS bypass and is a blocking review comment.**

A Drizzle connection over `postgres-js` / `DATABASE_URL` authenticates as a privileged database
role and bypasses Row Level Security completely. Every policy in LLD §6 would become decorative,
and the promise that a client cannot see `internal_amount` would rest on nothing but application
code being correct. An ESLint rule restricts `drizzle-orm` imports to `db/**` and
`lib/jobs/handlers/**`; a second restricts `lib/supabase/admin` to `lib/jobs/handlers/**`,
`lib/jobs/runner.ts` and `app/api/backup/report/route.ts` — the three places that actually hold a
`service_role` carve-out, and the exact set that rule's own `ignores` list exempts.

Money and stock mutations go through the `security definer` RPCs in LLD §5, which take row locks.
See `docs/decisions.md` D11 and `docs/architecture.md` §4.1.

---

## Repository layout

Root layout, not `src/` (D13).

```
├─ AGENTS.md               ← the hard rules
├─ CLAUDE.md               ← one line: @AGENTS.md
├─ docs/                   design documents, build plan, decisions, runbooks
├─ app/                    route segments — thin, compose features
│  └─ api/
│     ├─ cron/             Bearer CRON_SECRET; dispatches to lib/jobs/handlers
│     └─ health/           GET, unauthenticated, { db, r2, version, uptime }
├─ features/               one folder per domain
│  └─ <domain>/
│     ├─ queries.ts        reads, role-shaped DTOs
│     ├─ actions.ts        Server Actions: guard → validate → service → revalidate
│     ├─ service.ts        pure business logic, NO next/* imports
│     ├─ schema.ts         zod schemas shared by form and action
│     └─ components/       this domain's own tables, widgets and dialogs
├─ components/
│  ├─ ui/                  hand-rolled primitives, no business logic, do not restyle
│  ├─ layout/              Sidebar, Header, SearchBar, NotificationsMenu
│  ├─ auth/                SessionProvider, PreviewBanner
│  ├─ upload/              FileUploader
│  └─ shared/              genuinely cross-module pieces: DialogHost, StatusBadges,
│                          OpenDialogButton, NewRequestDialog (spans schedule + stock)
├─ context/                AppContext — prototype state, retired feature by feature
├─ hooks/
├─ lib/                    supabase, r2, money, rbac, jobs, xlsx, observability, env
├─ db/                     Drizzle schema + generated types
├─ supabase/
│  ├─ migrations/          versioned SQL. THE source of truth for schema.
│  ├─ seed.sql
│  └─ tests/               pgTAP RLS tests
└─ e2e/                    Playwright, incl. __screenshots__/proto-v1 visual baseline
```

**Layering rules — do not violate these.** Every one is binding. They differ only in what catches a
violation: some fail the build, the rest fail review. Each is marked, because believing a rule is
machine-checked when it is not is how it quietly stops being followed.

- **[ESLint]** `service.ts` must never import from `next/*` or `server-only`. It must be testable
  with a plain database connection.
- **[ESLint]** Components must never query the database directly. Data comes from `queries.ts` via a
  Server Component and arrives as props. Covers `components/**` and `features/*/components/**`;
  type-only imports are allowed.
- **[ESLint, partial]** A component specific to one domain lives in that domain's
  `features/<domain>/components/`, not in the top-level `components/` tree. Only genuinely
  cross-module or generic components belong in `components/` (`ui/`, `layout/`, `auth/`, `upload/`,
  `shared/`). See `MODULARIZATION_REPORT.md`. The rule only blocks the two old directory names
  (`components/domain`, `components/dialogs`) from reappearing — a domain component filed anywhere
  else in `components/` is a review catch, not a build failure.
- **[review]** `actions.ts` must contain no business arithmetic. Guard, parse, delegate, revalidate.
- **[review]** `components/ui/` holds generic primitives. Do not add domain logic there. Do not
  restyle them.
- **[review]** Dependency direction is strictly downward. Nothing depends on `app/`.

---

## Database rules

**These are hard rules. Violating any of them is a blocking review comment.**

1. **All schema change is a migration file** in `supabase/migrations/`. Never change schema
   through the Supabase dashboard. Never edit an already-applied migration — write a new one.

2. **Every migration that creates a table also enables RLS and adds its policies in the same
   file.** A table without RLS is publicly readable through PostgREST with the anon key.
   There are no exceptions, including for "internal" or "lookup" tables.

3. **Money is `numeric(14,2)`. Quantities are `numeric(14,3)`.** Never `float`, `real`,
   `double precision` or `money`. If you write a floating-point type for a currency value,
   the PR is rejected.

4. **Stock and money mutations go through the `security definer` RPCs in LLD §5**, never
   through application-level read-modify-write. The RPCs take row locks. Direct
   `update inventory_items set qty_on_hand = ...` from application code is a race condition.

5. **Index every column referenced in an RLS policy.** Unindexed policy predicates are the
   top cause of Supabase performance collapse.

6. **`stock_movements` and `audit_log` are append-only.** No role, including `owner`, gets
   update or delete. Corrections are compensating rows.

7. **Soft delete only** (`deleted_at`). GST record retention and stock arithmetic both break
   if rows disappear. Every query filters `deleted_at is null`.

8. Test RLS policies **from a client SDK session**, never from the SQL editor or
   `supabase db execute` — those bypass RLS and will tell you a broken policy works.

---

## Background job rules

1. **Every job must be idempotent.** Set `idempotency_key` on enqueue; re-running a handler
   must not double-write. Assume every job runs at least twice.
2. **Claim work with `rpc_claim_jobs`**, never a plain `select … where status='pending'`.
   The `FOR UPDATE SKIP LOCKED` inside it is what stops two overlapping cron ticks from
   double-running a job.
3. **Never do real work in the cron route handler.** Claim, dispatch to `lib/jobs/handlers`,
   record via `rpc_finish_job`. Handlers are pure and unit-testable.
4. Cron schedules are **UTC**, on both Vercel and GitHub Actions. IST is UTC+5:30 —
   `30 19 * * *` is 01:00 IST. Getting this wrong runs the backup during the working day.
   **`vercel.json` may only contain daily-or-less-frequent crons**: production is on Vercel
   Hobby, which caps cron frequency at once per day and **rejects the entire deployment** if a
   schedule is more frequent. Anything needing to run more often is triggered from
   `.github/workflows/` by a `curl` to the same `/api/cron/*` route — see `architecture.md`
   §5.4. That is why `jobs.drain` and `jobs.reap` are not in `vercel.json`.
5. `/api/cron/*` must reject any request lacking `Authorization: Bearer ${CRON_SECRET}`.
6. Don't add a job for work that fits in a request. Excel export renders inline; only
   long-running or retry-needing work is queued.
7. **`backup.nightly` failing is a P1.** It is the only recovery point. Its alert asserts that
   an object was actually written, not merely that the handler didn't throw.

---

## Billing rules

The billing engine computes tax. Treat it accordingly.

**The order of operations is fixed** (HLD §8.4). GST is charged on the taxable value
**before** retention is deducted, because under Indian GST retention money is part of the
value of the supply even though it hasn't been received:

```
gross         = work_value + material_value
taxable       = gross − mas_recovery
gst           = taxable × gst_rate_pct        ← GST base is taxable, NOT taxable − retention
invoice_total = taxable + gst
net_payable   = invoice_total − retention − tds − advance_recovery
```

If you find code deducting retention before computing GST, that is a bug — the earlier
prototype had it that way. Fix it and add a test.

- **Rates are snapshotted onto the bill at creation.** Changing `projects.gst_rate_pct`
  must never restate an issued bill.
- **Bills are immutable from `submitted` onward.** Corrections are a credit note or an
  adjustment on the next RA bill, never an edit.
- **Only a Client may certify a bill. Only a Client may decide an approval.** An Admin
  performing either would destroy the audit value of the whole chain. The RPCs enforce this;
  don't add an Admin bypass "for testing".
- Billing engine changes require **100% branch coverage** on the new code.
- Anything touching GST rates, TDS, or the treatment of material-at-site is **flagged for CA
  review, not decided in code review**. See HLD §8.4 for the five open tax questions.

---

## Conventions

**TypeScript**

- Strict mode. No `any`. No non-null assertion (`!`) — narrow properly.
- Types derive from Drizzle schema and zod; do not hand-write duplicate interfaces.
- Server-only modules start with `import 'server-only'`.

**Naming** — see LLD §1.1. Tables `snake_case` plural, views `v_*`, RPCs `rpc_*`, helper
functions `fn_*`.

**Components**

- Server Components by default. `"use client"` only on genuinely interactive leaves.
- One component per file. Colocate under the owning feature.
- Every table uses TanStack Table with server-side pagination past 100 rows.

**Styling**

- Strict monochrome. **Colour is reserved exclusively for status meaning** — the badge
  variants in `docs/ui-guide.md` §10 (green success, amber warning, red destructive, solid
  default, flat gray secondary, bordered outline). Do not introduce a brand colour, an
  accent, or a coloured button.
- Light and dark must both be checked on any UI change.
- Tailwind utility classes only; no CSS modules, no styled-components.

**Money display**

- Always `formatINR()` / `formatINRCompact()` from `lib/money`. Never inline
  `toLocaleString`. Indian digit grouping; L/Cr compaction on stat tiles only.

**Commits**

Conventional Commits: `feat(billing): add MAS recovery to bill creation`.
Scopes match feature folders: `projects`, `packages`, `schedule`, `updates`, `inventory`,
`stock`, `approvals`, `billing`, `users`, `auth`, `db`, `jobs`, `files`, `ci`, `docs`.

One build file is one branch is one PR. Branch names come from the build file header, e.g.
`build/01-foundations`. Squash-merge to `main`. `main` is always deployable.

---

## Testing expectations

| Change type              | Required tests                                                          |
| ------------------------ | ----------------------------------------------------------------------- |
| New table                | pgTAP policy test per role, in the same PR                              |
| New RPC                  | Integration test including the illegal-transition and concurrency cases |
| Billing logic            | Unit tests, 100% branch coverage                                        |
| New role-visible surface | pgTAP assertion that the forbidden columns are absent                   |
| New UI journey           | Playwright test for the affected role                                   |

The RLS test suite is the highest-value test code in this repository. Do not skip it,
`.only` it, or mark it flaky.

---

## Do not

- Do not create a separate backend service, REST API, or GraphQL layer without discussing
  it first (HLD §4.2 sets out when it would be justified).
- Do not add features not in `docs/01-hld.md` §2.1. Out of scope for v1: labour/timesheets,
  vendor portal, purchase orders, barcode scanning, snag lists, e-signatures, offline mode,
  i18n, accounting integration.
- Do not use `localStorage` or `sessionStorage` for anything except the theme preference.
- Do not use the Supabase `service_role` key anywhere reachable from the client bundle. It
  bypasses RLS entirely. It belongs only in `lib/jobs/handlers/**` and the auth admin path.
- Do not `select *` on `packages`, `phases`, `bills`, `bill_lines`, `stock_requests` or
  `inventory_items` in a code path a non-Admin can reach. Use the role-scoped views.
- Do not hard-code GST 18%, retention 5%, or MAS 75%. They are per-project columns.
- Do not add a `paid_amount` column to bills — part-payment goes in `payments`.
- Do not store derived values that can go stale (inventory status, over-budget, late flag).
  Cached rollups (`progress_pct`) are the exception and are trigger-maintained.
- Do not commit `.env.local`, service keys, R2 credentials, or seed data containing real
  client names beyond the demo dataset.

---

## When you are unsure

Stop and ask, rather than guessing, if the change touches:

- Tax arithmetic, GST rates, TDS, or retention treatment
- What any role can see (especially cost or margin)
- The stock request, approval, or bill state machines
- Anything that writes to `audit_log` or `stock_movements`
- Whether a new field belongs to the client-facing or internal side of a budget

Decisions live in **`docs/decisions.md`**. All sixteen are answered as of 2026-09-09. A
recommendation in a build file is an argument, not an answer — only an entry with a named person
and a date is a decision. If an entry you depend on is `PENDING`, or carries an open CA or counsel
confirmation, say so instead of picking an answer.

Two confirmations are still outstanding and are recorded at the foot of that file: the CA on
material-at-site treatment (D4) and on the statutory retention period (A-5), plus the five tax
questions in HLD §8.4.
