# Apex Projects — Production Architecture

**Version:** 0.1
**Date:** 09 September 2026
**Owner:** Voola / Apex Studios
**Audience:** Engineers building and operating this system, and whoever inherits it.

---

## 0. How this document relates to the others

| Document | Answers |
|---|---|
| `01-hld.md` | *What* we are building and why — domain, flows, business rules |
| `02-lld.md` | *How* it is specified — schema, RLS policies, RPC signatures, API surface |
| `architecture.md` (this) | *How it runs in production* — topology, trust boundaries, failure modes, SLOs, operations |
| `../AGENTS.md` | Working rules for anyone (human or agent) writing code in the repo |

If this document and the HLD disagree on architecture, this one is current. If this document
and the LLD disagree on a column or a policy, the LLD is current.

---

## 1. Architectural principles

These are the tie-breakers. When a decision is genuinely balanced, resolve it in this order.

1. **Confidentiality of margin outranks everything except correctness.** The product's
   entire value is that three audiences see three different truths from one dataset. A
   design that is faster, simpler or prettier but risks leaking `internal_amount` to a
   client loses.
2. **Correctness of money outranks convenience.** Bills compute tax. Exact arithmetic,
   immutable issued documents, gapless numbering, no floating point.
3. **One maintainer after launch.** Voola maintains this alone. Every additional service,
   queue, cache tier or bespoke abstraction is a permanent tax on one person. Prefer boring,
   prefer fewer moving parts, prefer managed.
4. **The database is the last line of defence, not the first convenience.** Business
   invariants live in constraints and `security definer` functions, so they hold even when
   application code is wrong.
5. **Everything a human decided is recoverable.** Append-only audit, soft delete, movement
   ledgers. Disputes surface months later; the system must be able to answer them.
6. **Degrade, don't disappear.** A failing background job, a slow R2, an expired token — each
   should reduce function, not take the site down.

---

## 2. System context (C4 Level 1)

```
                        ┌──────────────────────────────┐
   Apex staff  ────────►│                              │
   (Admin / Owner)      │                              │
                        │                              │
   Site supervisors ───►│      APEX PROJECTS           │◄──── Sentry (errors)
   (mobile, on site)    │      operations platform     │
                        │                              │
   Clients ────────────►│                              │
   (property owners)    └───┬──────────┬───────────┬───┘
                            │          │           │
                     ┌──────▼───┐ ┌────▼─────┐ ┌───▼──────┐
                     │ Supabase │ │Cloudflare│ │  Sentry  │
                     │ Postgres │ │    R2    │ │  errors  │
                     │  + Auth  │ │ (private)│ └──────────┘
                     └──────────┘ └──────────┘
                            ▲
                     ┌──────┴──────────┐
                     │ Vercel Cron     │  → /api/cron/*
                     │ + jobs table    │     (durability lives in Postgres)
                     └─────────────────┘

Out of band: accounting (Tally/Zoho) — humans move exported XLSX. No integration in v1.
Email notification is out of scope for v1 — the bell is in-app only.
```

**External dependencies and what happens if each dies** — see §8.2.

---

## 3. Container view (C4 Level 2)

```
┌────────────────────────────────────────────────────────────────────────┐
│  BROWSER (untrusted)                                                   │
│  Next.js 16 client bundle · React 19 · Tailwind v4 · own primitives      │
│  Holds: Supabase session cookie (httpOnly), theme preference           │
│  Holds NEVER: service_role key, R2 credentials, cost data for non-Admin│
└──────────┬──────────────────────────────────┬──────────────────────────┘
           │ HTTPS (RSC payload / Action POST)│ HTTPS PUT/GET (presigned)
           │                                  │
┌──────────▼──────────────────────────────┐   │
│  VERCEL — Node runtime, region bom1     │   │
│  ┌───────────────────────────────────┐  │   │
│  │ middleware.ts                     │  │   │
│  │  · refresh Supabase session       │  │   │
│  │  · attach request id              │  │   │
│  │  · deny unauthenticated routes    │  │   │
│  ├───────────────────────────────────┤  │   │
│  │ Server Components  (reads)        │  │   │
│  │ Server Actions     (writes)       │  │   │
│  │ Route Handlers     (/api/cron/*,  │  │   │
│  │                     /api/health)  │  │   │
│  ├───────────────────────────────────┤  │   │
│  │ Domain services (pure)            │  │   │
│  │  billing · rollup · rbac · money  │  │   │
│  └───────────────────────────────────┘  │   │
└───┬──────────────┬──────────────┬───────┘   │
    │ pg (user JWT)│ pg (service) │ HTTPS     │
    │              │              │           │
┌───▼──────────────▼───┐  ┌───────▼────────┐  │   ┌──────────────────┐
│ SUPABASE (bom1)      │  │ VERCEL CRON    │  │   │ CLOUDFLARE R2    │
│ · Postgres 15 + RLS  │  │ · hits         │  │   │ · apex-prod      │
│ · GoTrue auth        │  │   /api/cron/*  │  │   │   (private)      │
│ · Auth token hook    │  │ · state+retry  │  │   │ · apex-backups   │
│ · jobs table (queue) │  │   in Postgres  │  │   │   (private)      │
│ · PostgREST (unused  │  └───────┬────────┘  └──►│ presigned only   │
│   by app, but LIVE — │          │              └──────────────────┘
│   hence RLS on all)  │◄─────────┘
└──────────────────────┘
```

### 3.1 A deliberate note on PostgREST

Supabase exposes every table in the `public` schema over PostgREST with the anon key, whether
or not our application uses it. **Our app talks to Postgres through PostgREST itself (D11), and
the REST surface would be live regardless.** This is why RLS on every table is non-negotiable rather than
defence-in-depth: it is the *only* thing standing between a public API key and the whole
database. A table shipped without RLS is a public data breach, not a code smell.

---

## 4. Component view (C4 Level 3) — the Next.js container

```
app/                          Route segments. Params, layout, composition. Thin.
  │
  ├──► features/<domain>/queries.ts ──┐
  │      role-shaped reads             │
  │                                    ├──► lib/supabase/server.ts
  ├──► features/<domain>/actions.ts ───┤       (client bound to the USER's JWT)
  │      guard → zod → service         │
  │                    │               │
  │                    ▼               │
  │      features/<domain>/service.ts  │
  │      pure. no next/*. testable.    │
  │                    │               │
  │                    ▼               │
  │      supabase.from(...) / .rpc(...) ┘
  │             │                ──────► security definer functions
  │             ▼
  │      db/  (Drizzle) — schema, migrations, generated types.
  │             Query use is confined to lib/jobs/handlers/** (service_role).
  │
  ├──► lib/r2          presign, confirm, orphan sweep
  ├──► lib/rbac        role matrix, nav config, guards
  ├──► lib/money       INR formatting, rounding
  ├──► lib/jobs        enqueue, claim, handlers
  └──► lib/observability  request id, Sentry scope, structured log
```

**Dependency direction is strictly downward.** Nothing depends on `app/`. This is what makes
lifting the domain into a standalone service cheap if we ever need to (§14.3).

> **D11 (answered 2026-09-09).** An earlier draft of this diagram routed application queries
> through `lib/db (Drizzle)`. That was wrong and is corrected above. A Drizzle connection over
> `postgres-js` / `DATABASE_URL` authenticates as a privileged database role and **bypasses RLS
> completely**, which would make every policy in `02-lld.md` §6 decorative. User-context data
> access goes through the Supabase client bound to the user's JWT; sensitive writes go through
> `security definer` RPCs. Drizzle is retained for schema definition, migration generation,
> generated types and `service_role` job handlers. A Drizzle query in a request path is a
> blocking review comment, enforced by an ESLint import restriction. See `decisions.md` D11.

### 4.1 Two Supabase clients, never mixed

| Client | Key | Runs as | Used by |
|---|---|---|---|
| `createServerClient()` | anon key + user JWT from cookie | The signed-in user, **RLS applies** | All Server Components and Server Actions |
| `createAdminClient()` | `service_role` key | Superuser, **RLS bypassed** | Cron job handlers, auth admin operations, backup job — nothing else |

`createAdminClient` lives in a module marked `import 'server-only'` and is import-restricted
by an ESLint rule to `lib/jobs/handlers/**` and `lib/auth/admin.ts`. Using it in a request path is
a full RLS bypass, so the restriction is mechanical rather than cultural.

---

## 5. Deployment topology

### 5.1 Regions

Everything in **ap-south (Mumbai)**:

| Component | Region | Reason |
|---|---|---|
| Vercel functions | `bom1` | Users are in Hyderabad; ~15 ms to Mumbai |
| Supabase project | `ap-south-1` | Co-located with compute — cross-region DB round trips dominate P95 |
| Cloudflare R2 | `APAC` location hint | Site photos uploaded from mobile data connections |
| Vercel Cron | Invokes `bom1` functions | Same runtime and region as the app |

Co-locating Vercel and Supabase is the single highest-leverage latency decision. A page that
issues six queries pays six round trips; at 200 ms cross-region that is 1.2 s of pure wait.

### 5.2 Environments

| Environment | Compute | Database | Storage | Data |
|---|---|---|---|---|
| **Local** | `next dev` | hosted `apex-dev` (ap-south-1) — **no Docker, no local DB** (D14) | R2 dev bucket | `seed.sql`, pushed |
| **Preview** | Vercel preview per PR | Supabase **branch** (ephemeral, per PR) | R2 `apex-preview` | Seed only |
| **Production** | Vercel production | Supabase `apex-prod` | R2 `apex-prod` + `apex-backups` | Real |

The earlier Apex spec excluded a staging tier. This still holds — there is no long-lived
staging environment to maintain. But **Supabase preview branches give us the safety without
the maintenance**: each PR gets a real Postgres with migrations applied and seed data, torn
down on merge. Migrations and RLS policies are therefore always executed against a real
database before production. Cost is near zero; the alternative is debugging a billing
migration in production.

Production database changes only ever arrive through a merged, CI-verified migration.

### 5.3 Configuration and secrets

| Secret | Stored in | Rotation |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env (Production, encrypted) | On staff departure; annually |
| `SUPABASE_ANON_KEY` | Vercel env, client-exposed (safe by design — RLS protects) | With project |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Vercel env, server-only | Annually |
| `CRON_SECRET` (Bearer token guarding `/api/cron/*`), `SENTRY_DSN` | Vercel env | Annually |
| `DATABASE_URL` (direct, for migrations) | GitHub Actions secret | Annually |

Rules: no secret in the repo, `.env.local` gitignored, `.env.example` lists every key with
placeholder values. Any `NEXT_PUBLIC_*` variable is public — treat it as printed on a
billboard. CI fails on a secret-scanning hit (gitleaks).

---

## 6. Trust boundaries and security architecture

### 6.1 Boundaries

```
   ┌─ B1 ─────────────────────────────────────────────┐
   │  Browser. Fully untrusted. Assume the user can    │
   │  edit any request, replay any action, and read    │
   │  anything the server sends.                       │
   └───────────────────┬───────────────────────────────┘
                       │  ← Boundary 1: authenticate + authorise every request
   ┌─ B2 ──────────────▼───────────────────────────────┐
   │  Vercel server runtime. Trusted code, untrusted   │
   │  input. Holds service_role key.                   │
   └───────────────────┬───────────────────────────────┘
                       │  ← Boundary 2: RLS re-authorises, RPCs re-validate
   ┌─ B3 ──────────────▼───────────────────────────────┐
   │  Postgres. Final authority on who may see what.   │
   └───────────────────────────────────────────────────┘

   ┌─ B4 ─────────────────────────────────────────────┐
   │  R2. No ambient access. Every read and write is a │
   │  short-lived presigned URL issued after an app-   │
   │  level authorisation check.                       │
   └───────────────────────────────────────────────────┘
```

Boundary 2 is the one that matters. An attacker who finds an XSS or an authorisation bug in
the Next.js layer still cannot read another project's margin, because the database re-checks.

### 6.2 Authorisation — three independent layers

| Layer | Mechanism | Protects against |
|---|---|---|
| **L1 Rows** | RLS policies on every table, `force row level security` | Direct PostgREST access, wrong `where` clause, IDOR via URL param |
| **L2 Columns** | Non-Admins read via views that omit cost columns entirely | UI bug, over-broad `select *`, a DTO that forgot to strip a field |
| **L3 Application** | `next-safe-action` middleware guards on every action | Wrong role reaching a mutation at all; gives clean errors |

L2 deserves emphasis because it is unusual. Rather than fetching `internal_amount` and
hiding it, a client session's query **does not contain the column in its select list**. There
is no code path in which the number enters the response body. A React mistake cannot leak
what was never serialised.

### 6.3 Threat model

| # | Threat | Vector | Mitigation | Residual |
|---|---|---|---|---|
| T1 | Client sees internal cost/margin | UI bug, API over-fetch, direct PostgREST | L1+L2+L3; pgTAP test per role asserting absence | Low |
| T2 | Client certifies a bill they shouldn't, or Admin self-certifies | Forged action call | `rpc_transition_bill` checks `auth_role()` server-side; no Admin bypass exists | Low |
| T3 | IDOR — user edits URL to another project | `/projects/{uuid}` guessing | `is_member_of()` in every policy; UUIDv4 not enumerable | Low |
| T4 | Stale role after demotion | JWT holds `app_role` until refresh | 30-min access token TTL + forced global sign-out on role change | Low–Med (30 min window if sign-out call fails) |
| T5 | Attachment leakage | Presigned URL shared or leaked | 15-min TTL, private bucket, no public URLs, key not guessable | Med — a shared URL works until expiry. Accepted. |
| T6 | `service_role` key exposure | Imported into a client component | `server-only`, ESLint import restriction, gitleaks in CI | Low |
| T7 | Double-billing a phase or material | Concurrent Admin sessions | Unique index on `bill_lines(source_type, source_id)` | Very low |
| T8 | Duplicate/gapped bill numbers | Concurrent bill creation | `select … for update` on the project row serialises `next_bill_seq` | Very low |
| T9 | Stock double-count | Two supervisors tap Delivered | `for update` row lock + status re-check in RPC | Very low |
| T10 | Tampering with history | Editing a decided approval or issued bill | Immutability constraints; append-only `audit_log`, `stock_movements`, `bill_events` | Low |
| T11 | Malicious upload (script, oversized) | Presign abuse | MIME allowlist, size cap enforced at presign **and** verified by `HeadObject` at confirm; served with `Content-Disposition: attachment` | Low–Med — no AV scanning in v1 |
| T12 | Credential stuffing on staff logins | Weak passwords | Supabase password policy, mandatory TOTP for `owner`/`admin` | Low |
| T13 | Client magic-link interception | Shared/compromised mailbox | 10-min single-use link; OTP alternative | Med — inherent to email auth. Accepted. |
| T14 | Denial of wallet (function/DB abuse) | Automated request flood | Vercel WAF rate limiting; per-action throttle on presign and auth endpoints | Med on free tier |
| T15 | Insider misuse by Admin | Legitimate credentials | Full audit log, immutable, Admin-readable but not writable | Accepted — Admins are trusted by design |

**Not mitigated in v1, consciously:** antivirus scanning of uploads, WAF rules beyond
Vercel's defaults, IP allowlisting, hardware key enforcement. All are disproportionate for an
internal tool with ~50 known users. Revisit if the platform is ever resold (HLD D3).

### 6.4 Data classification

| Class | Examples | Handling |
|---|---|---|
| **Restricted** | `internal_amount`, `unit_cost`, `rate`, `margin_amount`, bill internal block | Admin/Owner only. Never in a non-Admin response body. Never in logs, Sentry breadcrumbs, or analytics. |
| **Confidential** | Contract values, bills, client contact details, site photos | Project members only. Presigned access. Not indexed by anything. |
| **Internal** | Task names, schedules, inventory quantities, daily updates | Project members. |
| **Public** | Nothing. | The application has no public surface beyond the login page. |

**Logging rule:** structured logs carry `user_id`, `role`, `project_id`, `request_id` and
never a monetary value or a personal name. Sentry scopes carry the same. If you need a money
value to debug, reproduce locally against seed data.

### 6.5 Application security baseline

- HTTPS only, HSTS with preload.
- Content Security Policy: `default-src 'self'`; R2 domain in `img-src` and `connect-src`;
  nonce-based `script-src`, no `unsafe-inline`, no `unsafe-eval`.
- Session cookies `httpOnly`, `Secure`, `SameSite=Lax`.
- Server Actions are POST-only with Next.js's built-in action-id origin check; all mutating
  routes reject cross-origin.
- Every action input parsed by zod before reaching a service. No hand-rolled validation.
- No `dangerouslySetInnerHTML` anywhere — daily update bodies render as plain text.
- Dependencies: Dependabot weekly, `pnpm audit` gate on high/critical in CI.

---

## 7. Data architecture in production

### 7.1 Lifecycle

```
 create ──► active ──► project completed ──► archived (12 months after close)
                                                  │
                                                  └─► retained indefinitely, read-only
```

Nothing is hard-deleted. `deleted_at` marks removal; archived projects move to
`status='archived'`, drop out of default lists, and their attachments get an R2 lifecycle
transition to infrequent-access. This is driven by two constraints:

1. **GST record retention.** Books and records must be preserved for the statutory period
   (confirm the exact term with your CA — it is measured from the annual return date, not the
   invoice date, and the platform must not be the reason a record is unavailable).
2. **Arithmetic integrity.** Deleting a stock movement or a bill line silently changes
   historical totals. The earlier proposal of a six-month retention window was rejected for
   exactly this reason and that rejection stands.

### 7.2 Backup and restore

| Property | Value |
|---|---|
| Method | **D17 (docs/decisions.md): a scheduled GitHub Actions workflow** (`.github/workflows/backup-nightly.yml`), not a Vercel function — there is no `pg_dump` binary in that runtime and its timeout is far shorter than a growing logical dump. `ubuntu-latest` runs real `pg_dump`, pipes to `gzip`, uploads to R2 `apex-backups/` with the AWS CLI using a token scoped to that bucket only, then calls `POST /api/backup/report` (Bearer `CRON_SECRET`) to record the outcome as a `backup.nightly` job row — same table, same Admin ops page as every other job. |
| Schedule | 19:30 UTC = 01:00 IST (the workflow's own cron, GitHub Actions schedules are UTC same as Vercel's) |
| Verification | **`/api/cron/backup.verify`, a real Vercel cron job, 21:00 UTC = 02:30 IST daily** — `HeadObject`s that day's expected key in `apex-backups` and lets a missing object THROW; its failure (landing in `jobs` as `failed`) is the alert. D17's own requirement: "assert an object was actually written, not merely that the handler did not throw." |
| Retention | 30 daily · 12 monthly (first-of-month promoted) — an R2 lifecycle rule on `apex-backups`, not application code |
| Encryption | R2 server-side; bucket private, separate credentials from the app bucket |
| RPO | 24 hours (free tier) → **15 minutes once on Supabase Pro with PITR** |
| RTO | 4 hours |
| Drill | **Quarterly restore drill into a scratch Supabase project, with a named owner and a calendar entry.** |

The verification line is still the important one, now split into two real, separately-scheduled
checks rather than one job trusted to both write and grade its own homework: the GitHub Actions
workflow WRITES the backup and reports its own outcome; `backup.verify`, running independently
half an hour later on Vercel, checks that a real object landed. Either one can fail without
silencing the other. An unverified backup is a belief, not a control.

The quarterly drill is done: restore the dump, run the pgTAP suite against it, spot-check the
most recent bill's arithmetic, record the elapsed time, delete the scratch project.

**Strong recommendation: move to Supabase Pro before the first real client is billed through
the system.** Free tier has no point-in-time recovery and pauses after seven days of
inactivity. ~$25/month against the cost of losing a day of site records and an issued RA bill
is not a close call.

### 7.3 Migration strategy

- Forward-only, versioned SQL in `supabase/migrations/`. Never edit an applied migration.
- Every table-creating migration includes its RLS policies in the same file.
- **Expand → migrate → contract** for anything breaking: add the new column nullable, backfill,
  dual-write, switch reads, drop the old column in a later release. Never a breaking change in
  one deploy — Vercel serves old and new function versions concurrently during a rollout.
- Long-running index builds use `create index concurrently` in a standalone migration.
- CI runs every migration against a fresh database plus against a preview branch seeded from
  a production-shaped dataset before merge.

### 7.4 Caching and revalidation

Almost every page is per-user and role-scoped, so **full-route static caching is not
available** — a cached page would serve one role's data to another. This is a correctness
constraint, not a performance oversight.

| Layer | Used for | Not used for |
|---|---|---|
| React `cache()` request dedupe | Same query called by layout and page in one render | — |
| `unstable_cache` with tags | Genuinely user-independent data (org settings, category lists) | Anything RLS-scoped |
| `revalidateTag` / `revalidatePath` | Invalidation after mutations, tagged by `project:{id}` | — |
| Client-side | TanStack Table state, optimistic task progress | Any authoritative money value |

Performance instead comes from: co-located database, indexed RLS predicates, cached rollup
columns on `projects` and `packages` (so the portfolio page doesn't aggregate every task),
partial indexes for the hot Billable Now query, and streaming with per-segment `loading.tsx`.

---

## 8. Reliability

### 8.1 Service level objectives

| SLO | Target | Measurement window |
|---|---|---|
| Availability (business hours, 09:00–20:00 IST) | 99.5% | Rolling 30 days |
| P95 dashboard page load | < 1.5 s | Rolling 7 days |
| P95 mutation (Server Action) | < 500 ms | Rolling 7 days |
| P99 mutation | < 2 s | Rolling 7 days |
| Successful background job rate | > 99% | Rolling 7 days |
| Bill PDF available within | 60 s of submission | Per event |

**Error budget policy:** if the availability SLO is breached in a rolling 30 days, the next
sprint prioritises reliability work over features. Stated up front so it isn't argued about
later.

These are honest targets for free-to-low-tier managed infrastructure and an internal tool.
This is not a payment gateway; do not design as though it is.

### 8.2 Dependency failure modes

| Dependency | Failure | Blast radius | Behaviour | Recovery |
|---|---|---|---|---|
| Supabase Postgres | Down | **Total** | 503 page with status link | Wait; restore from dump if data loss |
| Supabase Auth | Down | Existing sessions survive until token expiry; no new logins | Cached session keeps working ≤30 min | Wait |
| Vercel | Down | **Total** | — | Wait |
| Cloudflare R2 | Down | Uploads and downloads fail; **rest of app fine** | Upload UI shows retry; `attachments` rows unaffected | Retry; queued thumbnails resume |
| Vercel Cron | Missed invocation | PDFs, thumbnails, nightly backup delayed | Work stays `pending` in the `jobs` table; the next tick drains it. **Nothing is lost** — state is in Postgres, not in the scheduler. | Automatic on next run |
| Sentry | Down | Blind to errors | App unaffected; logs still in Vercel | Wait |

The pattern to notice: **only Postgres and Vercel are single points of failure.** Everything
else degrades a feature rather than the product. That is deliberate — notifications are
computed live from a database view rather than pushed into a queue — so there is no
notification pipeline that can be stale, and none to operate. Alerting to operators (§9.2)
uses Vercel/Sentry's own channels, not application email.

### 8.3 Concurrency and idempotency

| Risk | Control |
|---|---|
| Two supervisors mark one request Delivered | `select … for update` + status re-check inside `rpc_transition_stock_request` |
| Two Admins create bills on one project simultaneously | Row lock on `projects` serialises `next_bill_seq` — gapless, unique |
| Same phase billed twice | Unique index `bill_lines(source_type, source_id)` — database-enforced |
| Duplicate action submission (double-click, retry) | Client-generated idempotency key on `createBill` and `recordPayment`, stored and checked |
| Two Admins editing one package | Optimistic concurrency: `updated_at` sent with the form, mismatch → "changed by someone else, reload" |
| Inventory cache drifts from ledger | Nightly reconcile job recomputes from `stock_movements` and alerts on any delta |

Every job is idempotent by construction — keyed on the entity id via
`jobs(name, idempotency_key)`, safe to re-run. Retries back off exponentially
(1m, 2m, 4m, 8m, 16m); after `max_attempts` a job goes terminal as `failed` and appears on the
Admin ops page with a Retry button. `FOR UPDATE SKIP LOCKED` prevents two overlapping cron
invocations from double-running work, and an hourly reaper requeues jobs whose lease expired
because a function timed out mid-run.

### 8.4 Graceful degradation

- Presign failure → upload UI shows an inline retry; the daily update still posts with text.
- Rollup trigger failure → views compute the value live; slower, never wrong.
- PDF job failure → the bill is still Submitted and certifiable; the PDF appears on retry.
- Auth hook misconfigured → `auth_role()` falls back to a table read. Slower, still secure.

---

## 9. Observability

### 9.1 The three signals

**Logs** — structured JSON to Vercel. Every line carries `request_id`, `user_id`, `role`,
`route`, `duration_ms`. Never a money value, never a personal name (§6.4).

**Errors** — Sentry. Scope carries `user.id` and `role`, nothing more. Source maps uploaded
at build. Releases tagged with the git SHA so a regression is traceable to a deploy.

**Business telemetry** — surfaced *in the product*, not in a separate dashboard, because for
this system operational health and product value are the same thing:

- Approvals pending > 7 days
- Stock requests pending > 3 days
- Bills submitted and uncertified > 14 days
- Outstanding receivables, aged
- Inventory items Critical

A separate BI tool for a 50-user internal app would be a maintenance burden nobody would
open. Putting these on the Admin dashboard means they get looked at.

### 9.2 Alerts

| Alert | Condition | Channel | Severity |
|---|---|---|---|
| Site down | `/api/health` failing 3× consecutively | Email + phone | P1 |
| Nightly backup failed | The GitHub Actions workflow fails, or `backup.verify` finds no object written by 02:30 IST | Email | **P1** |
| Error rate spike | > 10 errors / 5 min in Sentry | Email | P2 |
| Inventory drift detected | Reconcile job finds cache ≠ ledger | Email | P2 |
| Job failed permanently | Any `jobs` row reaches `status='failed'` | Admin ops page + Sentry | P2 |
| DB usage > 80% of tier | Supabase metric | Email | P3 |
| R2 storage > 8 GB | Approaching free tier | Email | P3 |
| Slow query > 2 s | `pg_stat_statements` weekly digest | Email | P3 |

Backup failure is P1 and not negotiable. It is the compensating control for running on a tier
without point-in-time recovery; a silently failing backup means the risk was never actually
mitigated.

### 9.3 Health endpoint

`GET /api/health` returns `200` with `{ db, r2, version, uptime }` after a trivial `select 1`
and an R2 `HeadBucket`. Used by uptime monitoring and by the deploy pipeline's smoke check.

---

## 10. CI/CD

### 10.1 Pipeline

```
push / PR
   │
   ├─ install (pnpm, frozen lockfile)
   ├─ typecheck            tsc --noEmit, strict
   ├─ lint                 eslint + prettier + import restrictions
   ├─ secret scan          gitleaks
   ├─ unit tests           vitest — billing 100% branch coverage gate
   ├─ db: Supabase preview branch → migrations → seed   (no Docker, D14)
   ├─ RLS tests            pgTAP, every policy, every role      ◄── blocking
   ├─ integration tests    RPCs, concurrency, illegal transitions
   ├─ build                next build
   ├─ deploy preview       Vercel + ephemeral Supabase branch
   ├─ e2e                  Playwright, three role journeys, against preview
   └─ (on merge to main) → deploy production → smoke check /api/health
```

The RLS stage is blocking and cannot be skipped or marked continue-on-error. It is the test
suite that protects the product's core promise.

### 10.2 Release and rollback

- Trunk-based. Short-lived branches, squash merge to `main`, `main` always deployable.
- Every merge deploys. No release trains.
- **Rollback for code:** Vercel instant rollback to the previous deployment (seconds).
- **Rollback for schema:** there is none. Forward-only. This is why expand/migrate/contract
  (§7.3) is mandatory — a migration must always be compatible with the previous code version,
  so a code rollback is safe without a schema rollback.
- Feature flags: simple environment-variable booleans for the Billing module during Phase 4,
  so it can ship dark and be enabled per-project.

---

## 11. Capacity and cost

### 11.1 Sizing assumptions

| Dimension | Year 1 | Year 3 |
|---|---|---|
| Named users | 50 | 120 |
| Peak concurrent | 15 | 40 |
| Active projects | 20 | 60 |
| Lifetime projects | 60 | 400 |
| Tasks | 30k | 200k |
| Attachments | 15k / 12 GB | 80k / 60 GB |
| Largest table | `audit_log` ~2M rows | ~15M rows (partition monthly past 5M) |

None of this is large. The database fits comfortably in the smallest paid Supabase instance
for years. The design constraint here is not scale, it is **one maintainer** — which is why
there is no sharding strategy, no read replica, no cache tier. Adding those would cost more
in operational attention than they would ever save.

### 11.2 Cost

| Service | Free tier | Recommended at go-live | Year 3 |
|---|---|---|---|
| Vercel | Hobby (no SLA, non-commercial) | **Pro ~$20/mo** | ~$20/mo |
| Supabase | Free (no PITR, pauses at 7d idle) | **Pro ~$25/mo** | ~$25–50/mo |
| Cloudflare R2 | 10 GB free | Free → ~₹50/mo | ~₹800/mo (60 GB) |
| Vercel Cron | Included in plan | Included | Included |
| Sentry | Developer free | Free | Free |
| **Total** | ₹0 | **~₹4,000/mo** | **~₹8,000/mo** |

Roughly ₹4,000 a month buys an SLA, point-in-time recovery, and commercial licensing. Against
the value of a single RA bill this is a rounding error, and running a system that issues tax
invoices on a non-commercial hobby tier is a licensing problem as much as a reliability one.

---

## 12. Compliance posture

**GST (India).** The platform issues documents used as tax invoices. Therefore: rates
snapshotted per bill, issued bills immutable, gapless sequential numbering per project,
records retained indefinitely, corrections by credit note or next-bill adjustment only. Five
tax questions remain open in HLD §8.4 and require CA sign-off before go-live — GST rate for
Apex's specific contract types, TDS treatment, whether material-at-site is a secured advance
or a supply, delivery challan requirements for warehouse-to-site transfers, and e-invoicing
(IRN) applicability based on turnover.

**DPDP Act 2023 (India).** The system holds personal data of staff and client contacts.
Baseline posture: collect only what the workflow needs, no marketing use, access limited by
role and project membership, deletion on request handled by anonymising the profile while
preserving the audit trail (the audit entry keeps the actor id; the personal fields are
cleared). Breach notification and a named contact are process items, not code. **Confirm the
full obligation set with counsel** — I am describing a sensible baseline, not legal advice.

**Contractual.** Client sign-off in this system is an audited click, not a legally binding
e-signature. If a signed record is required for a dispute, the workflow is: client approves
in-app → Admin uploads the counter-signed PDF as an attachment. The platform is evidence, not
execution.

---

## 13. Runbooks

Concise, in the repo at `docs/runbooks/`. Each is a numbered procedure someone can follow at
2 a.m. without context.

| Runbook | Trigger | Summary |
|---|---|---|
| `restore-database.md` | Data loss / corruption | Pull latest dump from R2 → new Supabase project → restore → run pgTAP → repoint `DATABASE_URL` → verify latest bill |
| `backup-failed.md` | Backup alert | Check the GitHub Actions run log for `backup-nightly.yml` → check the `jobs` row `backup.verify` left and its `last_error` → check the R2 backup-scoped token → re-run the workflow manually (`gh workflow run backup-nightly.yml`) → if two consecutive nights fail, escalate to P1 |
| `inventory-drift.md` | Reconcile alert | Diff `qty_on_hand` vs `Σ stock_movements` → find the un-ledgered mutation → post a compensating `adjust` movement with reason → fix the code path |
| `bill-number-gap.md` | Gap in `bill_no` | Almost always a cancelled draft. Confirm via `bill_events`. Do **not** renumber — document the gap. |
| `role-change-not-taking-effect.md` | User reports wrong permissions | Stale JWT. Confirm `profiles.role`, then force global sign-out via admin API. Wait ≤30 min otherwise. |
| `supabase-paused.md` | Free tier idle pause | Resume from dashboard; if recurring, upgrade to Pro |
| `r2-outage.md` | Upload failures | Confirm Cloudflare status → app stays up → queue thumbnails → notify users that photos are delayed |
| `rotate-secrets.md` | Departure / annual | Rotate in provider → update Vercel env → redeploy → verify health → revoke old |
| `restore-drill.md` | Quarterly | The verification exercise for §7.2. Record elapsed time. |

---

## 14. Evolution

### 14.1 Designed-for extensions (no rework)

- **Purchase orders and GRNs** — slot between Approved and Ordered on the stock request
  lifecycle; `stock_movements` already carries `ref_type`/`ref_id`.
- **Weighted average costing** — the ledger already records `unit_cost` per movement; WAC is a
  view over it.
- **Multiple warehouses** — `inventory_items.project_id` becomes `location_id`.
- **BOQ / measurement-based billing** — a `boq_items` table under phases; `bill_lines` already
  carries `pct_billed` and quantities.
- **Sub-contractor billing (money out)** — mirrors `bills` with the sign reversed.

### 14.2 Would require real rework

- **Multi-tenant SaaS for other contractors** (HLD D3). `org_id` is on every table from day
  one, which is 80% of the work, but billing, onboarding, per-tenant branding, tenant-scoped
  backups and a much harder threat model are all new. Decide before launch, not after.
- **Offline mode for site supervisors.** Deliberately excluded. It would require a local
  store, conflict resolution and a sync protocol — a different application.
- **Realtime multi-user presence.** Supabase Realtime honours RLS and could be added, but the
  workflows here are not collaborative-simultaneous. Not worth the complexity.

### 14.3 If a standalone API service becomes necessary

Triggers: a native mobile app, a third-party integration, or a long-lived process Vercel's
model doesn't suit. The migration path is already open because `features/*/service.ts` is pure
and framework-free:

1. Extract `features/*/service.ts` and `lib/db` into a shared package.
2. Wrap in Fastify with the same guard middleware, deployed to Railway/Fly in ap-south.
3. Next.js Server Actions become thin clients of it.
4. RLS is unchanged — it never depended on which process opened the connection.

No business logic is rewritten. This is the entire reason for the layering rule in §4.

---

## 15. Architecture Decision Record log

| ADR | Decision | Rationale | Status |
|---|---|---|---|
| **001** | Next.js Server Actions are the backend; no separate Node service | One auth context, one deployment, one place permissions live. Three developers, one long-term maintainer. §14.3 keeps the exit cheap. | Accepted |
| **002** | Column isolation via role-scoped views, in addition to RLS | RLS filters rows, not columns. The product's core promise is column-level. A UI bug must not be able to leak margin. | Accepted |
| **003** | Inventory quantity derived from an append-only movement ledger | Auditability, reconciliation, and WAC later — all impossible with a mutable counter. | Accepted |
| **004** | Billing constants (GST, retention, MAS%) are per-project columns | Contracts differ. Hard-coding makes every new contract shape a code change. | Accepted |
| **005** | GST computed on taxable value **before** retention is deducted | Retention money is part of the value of the supply and is taxable when the RA bill is raised. The prototype's ordering understated output tax. | Accepted, **pending CA confirmation** |
| **006** | Rates snapshotted onto each bill at creation | A later project-level rate change must never restate an issued tax invoice. | Accepted |
| **007** | `audit_log`, `stock_movements`, `bill_events` are append-only for every role including `owner` | Disputes surface months later. History that can be edited is not evidence. | Accepted |
| **008** | Single private R2 bucket; presigned URLs only, no public bucket | Every file here is commercially sensitive or evidentially important. | Accepted |
| **009** | No long-lived staging tier; Supabase preview branches per PR instead | Migration safety without a second environment to maintain. Billing math must not debut in production. | Accepted (revises the earlier "no staging" decision) |
| **010** | Vercel Cron + a Postgres `jobs` table, **not** a managed workflow service | Eight simple jobs need scheduling and retry, not durable multi-step orchestration. Removes a vendor and a cost line. We own ~150 lines of retry/lease logic in exchange. Requires Vercel Pro for per-minute cron. | Accepted (revised — Inngest was the earlier choice) |
| **017** | Email notification out of scope for v1; the bell reads live from a DB view | No email dependency to operate. Cost lands on Clients, who now have no external prompt — expect to chase them by phone. Adding email later is a handler + template over the same `v_notifications` view. | Accepted |
| **011** | Tasks store real dates; the 14-week Gantt grid is a viewport | The prototype's `start_week` integer breaks when a project slips or the start date moves. | Accepted |
| **012** | Money mutations only through `security definer` RPCs, never app-level read-modify-write | Row locks are the only correct answer to concurrent status transitions. | Accepted |
| **013** | Soft delete everywhere; indefinite retention with archiving | GST retention plus arithmetic integrity. Supersedes the earlier six-month retention proposal. | Accepted |
| **014** | Notifications computed live from a view; no notification table, no read state | The notification *is* the work item. It disappears when the work is done. Also decouples the bell from email availability. | Accepted |
| **015** | Bills gain `cancelled` and a client-rejection path back to `draft` | A disputed bill in the prototype's state machine had nowhere to go. | Accepted |
| **016** | Upgrade to Vercel Pro and Supabase Pro at go-live | PITR, SLA, and commercial licensing for ~₹4,000/mo. Free tier is a development posture, not a production one. | Accepted 2026-09-09 (`decisions.md` ADR-016) |

---

## 16. Open architectural questions

> **All resolved 2026-09-09.** The answers, with their consequences, are in `decisions.md`
> (ADR-016, D3, D10, A-4, A-6, A-5). Item 1 is Pro on day one; item 2 is single-org with `org_id`
> everywhere; item 3 is accepted; item 4 is out for v1; item 6 is phone and manual prompting, with
> WhatsApp/SMS deferred; item 5 is the only one still genuinely open, awaiting the CA's statutory
> retention figure, and it blocks the R2 lifecycle rules in Build 10.
>
> The questions are kept below as the record of what was asked and why.

Blocking or shaping, carried from HLD §18 and narrowed to the ones that change *this*
document:

1. **Free tier vs Pro at launch** (ADR-016). My recommendation is Pro on day one. Running tax
   invoices on a hobby tier is a licensing and recovery risk, not just a reliability one.
2. **Single-tenant or future multi-tenant** (HLD D3). `org_id` is carried everywhere so the
   door stays open, but if reselling is a real plan, the threat model and backup strategy
   change materially and should be designed now.
3. **Preview branches** (ADR-009) — confirm you accept this, since it revises the earlier
   "no staging environment" decision.
4. **Upload antivirus scanning** — excluded in v1. Confirm that's acceptable given site photos
   arrive from supervisors' personal phones.
6. **Client prompting without email** (ADR-017). With notification in-app only, a Client has
   no external nudge for a pending approval or an uncertified bill. Confirm you're happy to
   chase by phone, or tell me and I'll scope WhatsApp/SMS instead of email — for Indian
   clients that is arguably the better channel anyway.
5. **Retention period for archived projects** — currently indefinite. Needs the exact statutory
   figure from your CA so the R2 lifecycle rules can be written.