# Apex Projects — High-Level Design (HLD)

**Version:** 0.1 (draft for review)
**Date:** 09 September 2026
**Owner:** Voola / Apex Studios
**Status:** Awaiting sign-off on the open decisions in §18

---

## 1. Purpose of this document

This HLD describes the architecture for turning the existing Apex Projects UI prototype
(`apex-studios-eight.vercel.app` — Next.js, client-side demo state, no backend) into a
production system with real persistence, real authentication, real money arithmetic and
real audit.

The prototype is treated as the **authoritative functional specification**. Every screen,
column, badge and formula documented in the *Apex Projects — UI & Product Guide* is in
scope. This document does not invent features; where it adds something, that addition is
called out explicitly and justified (almost always because the prototype's in-memory model
is not safe once money and multiple users are involved).

Read this document with `02-lld.md`, which contains the schema, RLS policies, RPC
signatures and API surface.

---

## 2. What the system is

Apex Studios is an interiors and construction contractor. The platform is the single
operational record for the jobs it runs.

**Domain hierarchy:**

```
Organisation (Apex Studios)
└── Client (T V Rao Housing Pvt Ltd)
    └── Project (BHEL Nagnar Club House)
        └── Package (Swimming Pool, Facade & Windows, Interiors, MEP)
            ├── Phase (line item with its own allocated + internal budget)
            │   └── Task (scheduled work, has % complete)
            ├── Stock Requests (material demand)
            ├── Approvals (client sign-off on samples/drawings)
            └── Daily Updates (site diary)
        └── Bills (RA bills raised against the project)
        └── Inventory (stock held for this project)
```

**The four questions the product answers** (from the product guide, unchanged):

1. What is this project costing?
2. What is happening on site today?
3. What needs my sign-off?
4. What do we bill next?

### 2.1 In scope

| Area | Detail |
|---|---|
| Portfolio & project management | Projects, packages, phases, tasks, week-grid Gantt, progress rollup |
| Budgeting | Allocated (client-facing) vs Internal (cost) budgets at package and phase level; committed and remaining |
| Site operations | Daily updates with photos, task progress updates |
| Material flow | Stock requests with a Pending → Approved → Ordered → Delivered lifecycle |
| Inventory | Per-project and business-wide stock, reorder levels, derived status |
| Client approvals | Sample / drawing / make sign-off with photo evidence |
| Billing | Billable-now selection, RA bill generation, GST/retention/recovery arithmetic, bill lifecycle, PDF & Excel export |
| Access control | Three roles (Admin, Site Supervisor, Client) with genuinely different data visibility |
| Notifications | Cross-project, role-scoped, computed live |

### 2.2 Explicitly out of scope (v1)

Carried forward from the earlier Apex specification and confirmed against the prototype:

- Barcode / QR scanning, bin-level storage locations
- Labour and timesheet tracking, payroll
- Snag / defect lists
- Vendor portal, purchase orders to vendors, vendor payment tracking
- Legally binding e-signatures (client "Approve" is an audited click, not a DSC)
- Accounting integration (Tally/Zoho). Accounting stays external; the platform exports.
- Offline mode
- Multi-language (English only)
- Field-level custom permissions (roles are fixed sets)

### 2.3 Deferred but designed-for

The schema leaves room for these without rework:

- Purchase orders and GRNs against stock requests
- Weighted-average costing (WAC) across receipts
- Multiple warehouses
- BOQ import and quantity-based measurement billing
- Sub-contractor billing (money flowing *out*)

---

## 3. Actors and roles

| Role | Who | Data visibility | Key powers |
|---|---|---|---|
| **Admin** | Apex Studios staff (John Israel Voola, Suresh K, Prakash R, Meena D) | Everything, including internal cost and margin | Create projects/packages, approve stock requests, create and submit bills, mark paid, manage users |
| **Site Supervisor** | On-site crew lead (Ravi) | Quantities, schedule, inventory, status. **No money.** | Post daily updates, raise stock requests, mark Delivered, update task progress |
| **Client** | Property owner (T V Rao) | Contract value and their own bills. **Never internal cost or margin.** | Approve/reject approvals, certify bills |

**The central invariant of the whole system:**

> Only Admin may ever see the gap between what the client is charged (`allocated`)
> and what the work costs (`internal`). This is not a UI toggle. It is enforced in the
> database, in the API layer, and in the shape of the data the client's browser ever
> receives.

This drives more architectural decisions than anything else in this document. See §7.

### 3.1 Role switching

The prototype lets you switch roles from the sidebar. In production this is removed and
replaced with real authentication. Admins get an **"impersonate / preview as"** capability
(read-only, audit-logged, banner-flagged) so they can verify what a client actually sees —
this is a genuine operational need for a system whose whole point is differential
visibility.

---

## 4. Architecture

### 4.1 Chosen shape

```
┌──────────────────────────────────────────────────────────────────┐
│                          Browser                                 │
│   Next.js 15 App Router · React Server Components · Tailwind v4  │
│   shadcn/ui · TanStack Table · react-hook-form + zod             │
└───────────────┬──────────────────────────────────────────────────┘
                │ RSC payload / Server Action RPC (POST)
┌───────────────▼──────────────────────────────────────────────────┐
│              Next.js Server Runtime (Vercel, bom1)               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Server Components (reads)  │ Server Actions (writes)       │  │
│  │  - query modules            │  - next-safe-action          │  │
│  │  - role-scoped selects      │  - zod input validation      │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Domain services: billing engine, progress rollup, RBAC     │  │
│  └────────────────────────────────────────────────────────────┘  │
└──┬────────────────┬───────────────────┬──────────────────┬───────┘
   │                │                   │                  │
┌──▼────────────┐ ┌─▼──────────────┐ ┌──▼────────────┐ ┌───▼────────┐
│ Supabase      │ │ Cloudflare R2  │ │ Vercel Cron   │ │ Sentry     │
│ Postgres+Auth │ │ private bucket │ │ + jobs table  │ │ errors     │
│ RLS + RPC     │ │ presigned URLs │ │ (in Postgres) │ │            │
└───────────────┘ └────────────────┘ └───────────────┘ └────────────┘
                                              │
                                     ┌────────▼─────────┐
                                     │ Sentry (errors)  │
                                     └──────────────────┘
```

### 4.2 Decision: there is no separate Node.js backend service

Your brief listed "Node.js for backend" **and** "Supabase for backend". These overlap, and
running both would mean three places where authorisation logic lives (RLS, Node service,
Next.js), which is exactly how permission bugs get shipped.

**Decision: Next.js is the backend.** Server Actions and Route Handlers *are* the Node.js
layer — they run on Node on Vercel. Supabase Postgres is the datastore and auth provider.

Rationale:

- One deployment unit, one auth context, one place to reason about permissions.
- Server Actions give end-to-end type safety from form to database without hand-writing
  a REST/GraphQL layer and its client.
- The team is three developers using Claude Code, with Voola as sole long-term maintainer.
  Fewer moving parts is the dominant constraint.
- Anything genuinely long-running (PDF generation, nightly backup, reconciliation) runs as a
  **Vercel Cron route backed by a `jobs` table in Postgres** — no third-party workflow
  service. See §10.

**When we would add a standalone service** — and only then:

- A mobile app needs a stable versioned REST/JSON API that isn't coupled to RSC.
- A third party (accounting software, a client's own ERP) needs to integrate.
- We need a long-lived process (WebSocket fan-out, a queue consumer) that Vercel's
  function model doesn't suit.

If that day comes, the domain services in `src/features/*/service.ts` are already pure
functions over the database — they lift into an Express/Fastify app without rewriting
business logic. This is why the layering in §4.3 matters.

### 4.3 Layering rules

```
app/            Route segments. Thin. Compose features, handle params, render.
features/       One folder per domain (projects, packages, billing, inventory, ...)
  ├─ queries.ts   Read functions. Take a session, return role-shaped DTOs.
  ├─ actions.ts   Server Actions. Auth → validate → call service → revalidate.
  ├─ service.ts   Pure business logic. No Next.js imports. Testable in isolation.
  ├─ schema.ts    Zod schemas, shared by form and action.
  └─ components/  Feature-owned UI.
components/ui/  shadcn primitives only. No business logic.
lib/            Cross-cutting: supabase clients, r2, money, rbac, jobs, pdf, xlsx.
db/             Drizzle schema, generated types, migration helpers.
```

Hard rule: `service.ts` never imports from `next/*`. `actions.ts` never contains business
arithmetic. `components/` never queries the database directly.

### 4.4 Request paths

**Read (page load):**

```
Request → middleware (refresh Supabase session)
        → Server Component
        → features/x/queries.ts
        → Supabase client bound to the user's JWT
        → Postgres: RLS filters rows, role-scoped view hides cost columns
        → DTO → rendered HTML
```

The client browser never receives internal cost for a non-Admin, because it was never
selected. Not hidden by CSS. Not filtered in React. **Never fetched.**

**Write (mutation):**

```
Form → Server Action (next-safe-action)
     → auth guard (session + role + project membership)
     → zod parse
     → service function
     → for money/stock: Postgres RPC inside a transaction
     → audit_log row written in the same transaction
     → revalidatePath / revalidateTag
```

**Money and stock mutations always go through a Postgres function, never through
application-level read-modify-write.** Two supervisors marking the same request Delivered
at the same instant must not double-count stock. The RPC takes row locks and re-validates
the current status before transitioning.

---

## 5. Data architecture

### 5.1 Entity map

```
orgs ──┬── clients ──── projects ──┬── project_members ──── profiles
       │                           ├── packages ──┬── phases ──── tasks
       │                           │              └── (lead → profiles)
       │                           ├── stock_requests ── stock_request_events
       │                           ├── approvals
       │                           ├── daily_updates
       │                           ├── bills ──┬── bill_lines
       │                           │           ├── bill_events
       │                           │           └── payments
       │                           └── inventory_items ── stock_movements
       └── attachments (polymorphic)
       └── audit_log
```

### 5.2 Key modelling decisions

**Budgets live on packages *and* phases.** A package's allocated/internal is the header
figure; phases carry the line-item breakdown. The prototype shows both. We store both and
do **not** enforce that phases sum to the package total — real projects have unallocated
contingency. We surface the variance instead of blocking it.

**Money is `numeric(14,2)`. Quantities are `numeric(14,3)`. Percentages are
`numeric(6,3)`.** Never `float`. Never `money`. `numeric(14,2)` holds up to ₹99,99,99,99,999.99
which is comfortably beyond any Apex project.

**Billing constants are per-project, not global.** GST rate, retention %, and the
material-at-site billable % are columns on `projects`, defaulted to 18 / 5 / 75 but
overridable — because contracts differ, and hard-coding them means every new contract
shape becomes a code change. The prototype's constants become defaults.

**Inventory quantity is derived from a movement ledger, not typed in.** `inventory_items`
carries a cached `qty_on_hand`, but the truth is `stock_movements`. Every delivery,
consumption and adjustment writes a movement row inside the same transaction that updates
the cache. This gives us an audit trail, makes reconciliation possible, and is the
foundation for WAC later. A nightly cron job reconciles cache against ledger and alerts
on drift.

**Negative stock is blocked at the database level** with a check constraint, with no role
override. Carried forward from the earlier locked decisions.

**Status is derived wherever it can be.** Inventory status (Critical / Low / OK), package
over-budget, and phase billability are computed from views, not stored — so they can never
go stale. Bill status and stock request status *are* stored, because they represent
human decisions with a legal/commercial meaning, not a computation.

**Everything is soft-deleted.** `deleted_at timestamptz`. GST record-retention and WAC
arithmetic both break if rows vanish. Carried forward from locked decisions: keep
everything indefinitely, archive closed projects.

### 5.3 Derived value catalogue

| Value | Definition | Where |
|---|---|---|
| Committed (package) | `Σ qty × rate` for stock requests in status Approved, Ordered or Delivered | `v_package_rollup` |
| Remaining | `internal_amount − committed` | `v_package_rollup` |
| Used % | `committed / internal_amount` | `v_package_rollup` |
| Progress (package) | Duration-weighted mean of task `progress_pct`: `Σ(duration_weeks × progress) / Σ(duration_weeks)` | `v_package_rollup` |
| Progress (project) | Allocated-weighted mean of package progress | `v_project_rollup` |
| Cost→client factor | `phase.allocated / phase.internal`, falling back to `package.allocated / package.internal` when the phase has no internal figure | `fn_cost_to_client_factor()` |
| Inventory status | `qty = 0` → Critical; `0 < qty < reorder_level` → Low; else OK | `v_inventory_status` |
| Phase billable | All tasks at 100%, **or** `manual_complete_at IS NOT NULL` | `v_phase_billing` |
| Material billable | Stock request reached Delivered and not yet on a non-cancelled bill | `v_billable_now` |

Note the project-progress definition is an addition — the prototype only defines package
progress. Weighting by allocated value rather than task count is the honest choice, since
a ₹40L package and a ₹2L package should not move the needle equally.

---

## 6. Authentication

| Actor | Method | Rationale |
|---|---|---|
| Admin, Site Supervisor | Supabase Auth, email + password, mandatory TOTP for Admin | Staff, repeat daily use, need speed |
| Client | Magic link to email **or** phone OTP | External, infrequent, must not manage a password for a system they use monthly |

- Invitation-only. There is no public sign-up. `POST /signup` is disabled at the Supabase
  project level.
- A **Custom Access Token Auth Hook** stamps `app_role` and `org_id` into the JWT at token
  issue, so RLS can read them without a table join on every policy evaluation.
- **Known caveat:** a JWT keeps its claims until refresh. If an Admin changes someone's
  role, the old role persists for the remainder of the access-token lifetime. Mitigation:
  set the access token TTL to 30 minutes, and on any role change call the Admin API to
  revoke that user's refresh tokens, forcing re-auth. This is a documented Supabase RBAC
  gotcha and needs to be handled deliberately, not discovered in production.
- Session refresh happens in `middleware.ts` on every request.

---

## 7. Authorisation — the three-layer model

Because the entire product rests on Admin-only cost visibility, authorisation is enforced
three times. Redundancy here is deliberate.

### Layer 1 — Row Level Security (Postgres)

Every table has RLS enabled. Nothing is reachable without a matching policy.

Helper functions (all `stable`, `security definer`, `set search_path = ''`):

```sql
auth_role()              → app_role      -- reads JWT claim
auth_org()               → uuid
is_admin()               → boolean
is_member_of(project_id) → boolean       -- checks project_members
```

Standard project-scoped read policy:

```sql
create policy "read own projects"
  on public.packages for select
  to authenticated
  using ( is_admin() or is_member_of(project_id) );
```

Every column referenced in a policy is indexed. Missing indexes on RLS predicate columns
are the single biggest performance failure mode in Supabase deployments.

### Layer 2 — Column isolation via role-scoped views

RLS filters *rows*. It does not filter *columns*. So we never let a non-Admin session
select from a table containing cost data at all.

- `packages`, `phases`, `bills`, `bill_lines`, `inventory_items`, `stock_requests` have
  `select` granted **only** where `is_admin()`.
- Non-Admins read through `security definer` views that physically do not project the
  cost columns:

```sql
create view public.v_package_client as
  select id, project_id, seq_no, name, lead_profile_id,
         allocated_amount,          -- yes: this is the contract value
         status, progress_pct
  from public.packages
  where is_member_of(project_id);
  -- internal_amount, committed, margin: absent. Not null. Absent.

create view public.v_package_site as
  select id, project_id, seq_no, name, lead_profile_id,
         status, progress_pct, open_request_count
  from public.packages
  where is_member_of(project_id);
  -- no money columns at all
```

A bug in a React component cannot leak margin to a client, because the number was never in
the response body.

### Layer 3 — Application guard

Every Server Action begins with an assertion:

```ts
const session = await requireRole(['admin']);
await requireProjectAccess(session, projectId);
```

`next-safe-action` middleware makes this the default rather than something to remember.

### 7.1 Permission matrix (authoritative)

| Capability | Admin | Site | Client |
|---|:--:|:--:|:--:|
| View dashboard, packages, schedule, daily updates | ✅ | ✅ | ✅ |
| View inventory (project + business-wide) | ✅ | ✅ | — |
| View stock requests | ✅ | ✅ | — |
| View approvals | ✅ | ✅ | ✅ |
| View bills | ✅ | — | ✅ (own project) |
| View users | ✅ | — | — |
| **See internal cost / margin** | ✅ | — | — |
| See allocated / contract value | ✅ | — | ✅ |
| Create/edit project, package, phase | ✅ | — | — |
| Create/edit task, set progress | ✅ | ✅ | — |
| Post daily update | ✅ | ✅ | — |
| Raise stock request | ✅ | ✅ | — |
| Approve / reject stock request | ✅ | — | — |
| Mark stock request Ordered | ✅ | — | — |
| Mark stock request Delivered | ✅ | ✅ | — |
| Request approval, add sample photos | ✅ | ✅ | — |
| **Approve / reject an approval** | — | — | ✅ |
| Create bill, submit bill | ✅ | — | — |
| **Certify (approve) a bill** | — | — | ✅ |
| Mark bill Paid, record payment | ✅ | — | — |
| Invite user, change role | ✅ | — | — |

Note two deliberate *negatives*: Admin cannot approve an approval, and Admin cannot certify
a bill. Those are client acts. Allowing Admin to self-certify would destroy the audit value
of the whole approval chain. If a client signs off verbally, an Admin records it as an
`offline_certification` with a note and an uploaded scan — a distinct, visibly-different
action — rather than clicking the client's button.

---

## 8. Core process flows

### 8.1 Stock request lifecycle

```
                       ┌──────────┐
   Admin/Site raise →  │ Pending  │
                       └────┬─────┘
              Admin approve │   │ Admin reject
                       ┌────▼──┐ └──────► Rejected (terminal)
                       │Approved│
                       └────┬───┘
             Admin mark ord │
                       ┌────▼───┐
                       │Ordered │
                       └────┬───┘
        Admin or Site mark  │ delivered
                       ┌────▼─────┐
                       │Delivered │ (terminal)
                       └──────────┘
```

Side effects, all inside one transaction with the status change:

| Transition | Side effects |
|---|---|
| → Approved | Counts toward package `committed`. Notification to requester. |
| → Ordered | No stock effect. Notification to site. |
| → Delivered | `stock_movements` IN row; `inventory_items.qty_on_hand` incremented; item becomes eligible for Billable Now at the material rate; notification to Admin. |
| → Rejected | Removed from `committed`. Notification with reason (reason is mandatory). |

Illegal transitions (Pending → Delivered, anything out of a terminal state) are rejected by
the RPC with a domain error, not just hidden in the UI.

### 8.2 Approval lifecycle

```
Admin/Site request  →  Pending  ──client approve──►  Approved (terminal)
                          │
                          └────client reject─────►  Rejected (terminal)
```

- Photos may be appended while Pending. Once decided, the record and its attachments are
  frozen — this is the evidence trail for "you approved this finish".
- Rejection requires a reason.
- A rejected approval cannot be re-opened; a new approval is raised referencing the old one
  via `supersedes_id`. (Addition to the prototype — necessary so revision history survives.)

### 8.3 Billing lifecycle

```
Admin selects from Billable Now  →  Draft
                                      │ Admin submit
                                      ▼
                                  Submitted  ──client reject──►  Draft (with reason)
                                      │ client approve
                                      ▼
                                  Certified
                                      │ Admin records payment in full
                                      ▼
                                    Paid
```

- Adding client *rejection* of a bill is an addition to the prototype's state machine.
  Without it, a disputed bill has nowhere to go. It returns to Draft with the reason
  attached and an incremented revision number.
- **A bill's line items are immutable from Submitted onward.** Correcting an issued bill
  means a credit note or an adjustment on the next RA bill — never a silent edit. This is
  a GST requirement, not a preference.
- `Cancelled` is a fourth terminal state for a Draft that is abandoned, so its lines return
  to Billable Now.

### 8.4 Billing engine (corrected arithmetic)

This is the part of the prototype that needs correcting before it touches a real invoice.

**What the prototype does:**
`Gross → less previously-billed material → Taxable → less 5% retention → +18% GST → Net Payable`

**The problem:** retention is deducted *before* GST, so GST is charged on 95% of the
value. Under Indian GST, retention money is part of the value of the supply — tax is
payable on the full RA bill value including the retained amount, whether or not the money
has been received. Deducting retention from the tax base understates output GST, which is
a liability at assessment.

**Corrected order:**

```
A. Value of work done this period       Σ completed phase milestones × client value
B. Value of material at site            Σ delivered material × client value × mas_billable_pct
                                        (default 75% — this is a secured advance
                                         against material, not a sale)
C. Gross this bill                      A + B

D. Less: MAS recovery                   material previously advanced under (B) that is now
                                        embedded in a phase being billed under (A)
                                        → prevents double-billing

E. Taxable value                        C − D                       ← this is the GST base

F. GST                                  E × gst_rate_pct  (default 18%)
G. Invoice total                        E + F

H. Less: retention                      E × retention_pct (default 5%)   ← on basic value
I. Less: TDS                            E × tds_pct (194C: 1% individual/HUF, 2% others)
J. Less: mobilisation advance recovery  per recovery schedule, if any

K. Net payable                          G − H − I − J
```

Cumulative columns (`billed to date`, `this bill`, `cumulative`) are rendered on the bill
document because Indian RA bills are conventionally cumulative — each bill restates work
to date so earlier errors self-correct on the next bill. Internally we still store discrete
lines; the cumulative view is a presentation over `Σ` of prior bills.

**Internal margin block (Admin only):** `internal_cost = Σ bill_lines.internal_cost`,
`margin = taxable_value − internal_cost`, `margin_pct = margin / taxable_value`. This lives
on `bills` but is only ever selected by an Admin session.

**⚠ Requires CA confirmation before go-live** (do not take these from me):

1. The correct GST rate for Apex's specific contracts — 18% for pure works contracts, but
   composite supply for under-construction residential can attract 5% or 12%, and it varies
   by contract type.
2. Whether TDS under 194C should be modelled as a deduction the platform computes, or left
   entirely to the client's accounts team.
3. Whether material-at-site billing at 75% is structured in Apex's contracts as a secured
   advance (recoverable, arguably not a supply at that moment) or as a sale of goods
   (immediately taxable). The GST treatment differs and this changes the schema.
4. Whether delivery challans are required for warehouse→site transfers (carried over
   unresolved from the earlier spec, item C2).
5. E-invoicing (IRN) applicability based on Apex's aggregate turnover.

The platform is built so all five are configuration, not code.

### 8.5 Progress rollup

Task `progress_pct` changes → phase completion recomputed → if all tasks 100%, phase
becomes Billable → package progress recomputed → project progress recomputed.

Implemented as a `after update` trigger on `tasks` that refreshes cached rollup columns,
plus views for anything not worth caching. Cached because the packages table is rendered on
the portfolio page for every project, and recomputing a weighted mean over every task on
every portfolio load does not scale past a handful of projects.

A task past its scheduled end date without 100% progress is flagged **late** — derived at
read time from `end_date < current_date and progress_pct < 100`, never stored.

---

## 9. File storage

**Cloudflare R2, one private bucket, no public bucket.**

Every file in this system is either commercially sensitive (bill PDFs), evidentially
important (approval sample photos) or both. Nothing is served from a public URL.

**Key layout:**

```
org/{org_id}/project/{project_id}/{entity}/{entity_id}/{uuid}-{safe_filename}

e.g. org/a1b2/project/c3d4/approval/e5f6/9a8b-marble-sample-01.jpg
     org/a1b2/project/c3d4/bill/g7h8/2c1d-RA-03-signed.pdf
```

Keys embed the ownership path so an orphaned object is still traceable, and so lifecycle
rules can be scoped per project on archive.

**Upload flow (direct-to-R2, presigned):**

```
1. Client calls a Server Action: requestUploadUrl({ entityType, entityId, fileName, mime, size })
2. Server: auth check → project access check → validate mime allowlist + size cap
           → generate key → presign PUT (5 min TTL) → return { url, key }
3. Browser PUTs the file directly to R2. The file never transits Vercel.
4. Client calls confirmUpload({ key, ... }) → server HEADs the object to verify it exists
   and matches the declared size → inserts the `attachments` row.
```

Step 4 matters: without it, a failed or abandoned upload leaves a database row pointing at
nothing. We only record what we can confirm.

**Read flow:** presigned GET, 15-minute TTL, generated per request after an RLS-equivalent
access check. Thumbnails for photo grids are generated by a queued job on upload and
stored alongside under a `thumb/` prefix, so the 4-photo grids in the UI don't pull full
5MB site photos.

**Constraints:** images `image/jpeg|png|webp` max 10 MB; documents `application/pdf` max
25 MB; max 4 photos per approval/update as per the UI; total per-project cap alerted at
5 GB (R2 free tier is 10 GB).

---

## 10. Background jobs

**No third-party job runner.** Scheduling is Vercel Cron; durability is a `jobs` table in
Postgres. This is a deliberate reduction — a managed workflow service buys durable
multi-step orchestration, replay and a dead-letter queue, and none of the eight jobs below
needs any of that. What we give up is retry logic we now own; see the trade-off note at the
end of this section.

### 10.1 How it works

```
Vercel Cron ──► GET /api/cron/{job}          (Bearer CRON_SECRET)
                       │
                       ├─ claim: UPDATE jobs SET status='running', lease_until=now()+5min
                       │         WHERE ... FOR UPDATE SKIP LOCKED LIMIT n
                       ├─ execute the handler
                       └─ record: succeeded | failed (attempts+1, backoff, last_error)
```

Two flavours share one table:

- **Scheduled** — cron enqueues and runs in the same request (backup, reconcile, archive).
- **Queued** — a Server Action inserts a `jobs` row (thumbnail, bill PDF); a drain cron
  running every minute picks up pending rows.

`FOR UPDATE SKIP LOCKED` is what makes this safe when two cron invocations overlap: the
second skips rows the first has claimed rather than blocking or double-running. `lease_until`
covers the case where a function times out mid-job — a reaper requeues expired leases.

### 10.2 The jobs

| Job | Kind | Schedule | Purpose |
|---|---|---|---|
| `backup.nightly` | Scheduled | 01:00 IST | `pg_dump` logical backup → R2 `apex-backups/`. **P1 alert on failure.** |
| `inventory.reconcile` | Scheduled | 02:00 IST | Recompute `qty_on_hand` from `stock_movements`; alert on drift |
| `jobs.drain` | Scheduled | every minute | Pick up queued work |
| `jobs.reap` | Scheduled | hourly | Requeue jobs whose `lease_until` expired |
| `attachment.thumbnail` | Queued | on upload confirm | Resize to 400px, store under `thumb/` |
| `bill.pdf` | Queued | on bill submit | Render RA bill PDF, store in R2, attach |
| `attachment.orphan_sweep` | Scheduled | weekly | Delete R2 objects with no `attachments` row, older than 24h |
| `project.archive` | Scheduled | weekly | Archive projects closed > 12 months |

Excel export is **not** a job — `exceljs` renders fast enough to stream directly from a route
handler on request. One less moving part.

### 10.3 What we own now

| Concern | Managed service gave us | Our implementation |
|---|---|---|
| Retry | Automatic, backed off | `attempts`, `max_attempts`, exponential `run_after` |
| Dead letter | DLQ with replay UI | `status='failed'` rows, listed on an Admin ops page, retryable with a button |
| Timeout recovery | Automatic | `lease_until` + hourly reaper |
| Observability | Run history dashboard | The `jobs` table itself, plus Sentry on handler exceptions |
| Concurrency | Managed | `FOR UPDATE SKIP LOCKED` |

That is roughly 150 lines of code in `lib/jobs`, written once. It is a fair trade at this
scale, and it removes a vendor from the dependency list.

**Two things this depends on:**

1. **Vercel Pro.** The Hobby tier permits only a couple of cron invocations per day at fixed
   times, which cannot run a per-minute drain. This is already the recommendation in
   `architecture.md` ADR-016 for SLA and licensing reasons.
2. **The backup alert actually firing.** `backup.nightly` is the compensating control for
   running without point-in-time recovery. A silently failing backup means the risk was never
   mitigated. It is P1 and it is checked by a separate assertion — the alert fires if no
   object was written by 02:00, not merely if the handler threw.

## 11. Notifications

The prototype computes notifications live from current data with no read state. **We keep
that.** It is genuinely the right design here: the notification *is* the work item. There is
no value in "marking read" a pending approval that is still pending — it disappears when
the work is done.

| Role | Bell shows |
|---|---|
| Admin | Pending stock requests · Bills Submitted (awaiting certification) · Inventory Low or Critical |
| Site | Pending stock requests · Inventory Low or Critical |
| Client | Approvals Pending · Bills Submitted (awaiting their approval) |

Scoped across **all** projects the user can access, not just the current one. Implemented
as one `v_notifications` view, `union all` over the source queries, filtered by role and
membership.

**Email is out of scope for v1.** Notification is in-app only — the bell plus the aged-item
tiles on the Admin dashboard. The cost of this falls almost entirely on the Client role:
staff are in the app daily and will see the bell, but a client who only logs in when
prompted now has no prompt. Expect to chase clients by phone for pending approvals and
uncertified bills until email is added. The `v_notifications` view is already the right shape
to drive a digest later — adding email is a job handler and a template, not a redesign.

---

## 12. UI architecture

Preserved from the prototype:

- Strict monochrome theme, light/dark, `localStorage`-persisted, OS default on first visit.
- **Colour reserved exclusively for status meaning.** Green/amber/red/black/gray/outline
  badge variants exactly as specified in the product guide §10.
- Indian digit grouping (`₹1,23,456`), with L/Cr compaction on stat tiles.

Production additions:

- **Mobile-first for the transactional surfaces** (daily updates, stock requests, task
  progress, approvals) — a supervisor uses this on a phone on site. **Desktop-first for the
  analytical surfaces** (billing, portfolio, inventory tables). Carried forward from locked
  decisions.
- Server Components by default; `"use client"` only for genuinely interactive leaves
  (Gantt bars, dialogs, filters, theme toggle).
- Optimistic UI on task progress and status transitions, with rollback on server rejection.
- Every table is a TanStack Table with server-side pagination past 100 rows.
- Loading skeletons per route segment via `loading.tsx`; error boundaries per segment.

---

## 13. Non-functional requirements

| Dimension | Target | Notes |
|---|---|---|
| Concurrent users | 50 | Realistic for one contractor: staff + supervisors + a handful of clients |
| Projects | 200 active, 1,000 lifetime | |
| Tasks per project | ~500 | |
| Attachments | ~50k objects, ~40 GB at 3 years | Exceeds R2 free tier around year 1 — budget ~₹60/month, trivial |
| P95 page load (dashboard) | < 1.5 s | Mumbai region, both Vercel and Supabase in bom1 |
| P95 mutation | < 500 ms | |
| Availability target | 99% business hours IST | Free-tier infrastructure; explicitly not a 99.9% system |
| RPO | 24 hours | Nightly logical dump |
| RTO | 4 hours | Restore from dump into a fresh project |
| Data retention | Indefinite | GST record-keeping; archive, never delete |

**Accepted risks (explicitly, with mitigations):**

- Supabase free tier pauses after 7 days of inactivity and has no PITR. Mitigation: nightly
  dump to R2; upgrade to Pro (~$25/mo) before the first real client is billed through the
  system. *Strong recommendation: do this at go-live, not later.*
- Vercel free tier has no SLA and commercial-use limits. Mitigation: Pro at go-live.
- Single region. An ap-south outage takes the system down. Accepted — this is an internal
  ops tool, not a payment gateway.

---

## 14. Observability

- **Sentry** for errors, with `user.id` and `role` tagged on every event (never PII beyond
  the id).
- **Structured audit log** in Postgres: every mutation writes `{actor, entity, action,
  before, after, at}` in the same transaction as the change. This is queryable by Admin from
  a Users → Audit screen. For a system where the client's sign-off is the commercial
  record, "who marked this Delivered and when" must be answerable years later.
- **Business metrics** surfaced in-app rather than in a separate dashboard: bills
  outstanding, approvals aged > 7 days, requests aged > 3 days. Operational health *is* the
  product.

---

## 15. Environments, CI/CD and migrations

| Environment | Supabase | Vercel |
|---|---|---|
| Local | `supabase start` (Docker) | `next dev` |
| Production | Project `apex-prod` (bom1) | Production deployment (bom1) |

The earlier spec explicitly excluded a staging environment. **I would push back on that
one.** Not a full staging tier, but a *preview* Supabase branch wired to Vercel preview
deployments, so migrations run against a real copy before touching production. Supabase
branching makes this nearly free in effort. Billing arithmetic and RLS policies are exactly
the kind of thing that must not be first executed in production.

**Migration rules (non-negotiable):**

- All schema change is a versioned SQL file in `supabase/migrations/`. **Never** a change
  made in the Supabase dashboard.
- Migrations are forward-only. A mistake is fixed by a new migration.
- Every migration that adds a table also adds its RLS policies **in the same file**. A
  table without RLS is publicly readable through PostgREST — this is the single most common
  and most severe Supabase mistake.
- Drizzle is used for typed queries; the SQL migration file is the source of truth for
  schema. Drizzle schema is kept in sync and CI fails on drift.

**CI (GitHub Actions):** typecheck → lint → unit tests → `supabase db reset` + pgTAP RLS
tests → build → Playwright e2e against preview → deploy.

---

## 16. Testing strategy

| Layer | Tool | What must be covered |
|---|---|---|
| Unit | Vitest | Billing engine arithmetic (every branch), progress rollup, cost→client factor, money formatting, status transition legality |
| Database | pgTAP | **Every RLS policy, per role.** Explicitly: a Client session selecting `internal_amount` must error, not return null. |
| Integration | Vitest + local Supabase | RPCs: concurrent Delivered, double-billing prevention, negative-stock block |
| E2E | Playwright | The three role journeys from product guide §14, end to end |
| Visual | Playwright snapshots | Badge colours, light/dark, Gantt rendering |

**The RLS test suite is the highest-value tests in this repo.** Policies must be tested
from a client SDK session, never from the SQL editor — the SQL editor bypasses RLS and will
happily tell you a broken policy works.

Minimum bar for the billing engine: 100% branch coverage. It computes tax.

---

## 17. Delivery phases

**Phase 0 — Foundations (1 week)**
Repo, Next.js 15 + TS strict, Tailwind v4, shadcn, Supabase local, Drizzle, CI, Sentry,
auth (all three methods), profiles, orgs, RLS helpers, `AGENTS.md`. Nightly backup job.

**Phase 1 — Core hierarchy (2 weeks)**
Projects, packages, phases, tasks. Portfolio and project dashboard. Packages table with all
three role shapes. Gantt. New/Edit dialogs. Progress rollup.
*Exit criteria: an Admin can set up a real project and a Client sees the correct subset.*

**Phase 2 — Site operations (1.5 weeks)**
Daily updates, R2 upload pipeline, thumbnails, stock requests with full lifecycle,
inventory (project + business-wide), movement ledger, notifications bell.
*Exit criteria: Ravi can run a day's site work from his phone.*

**Phase 3 — Approvals (1 week)**
Approval lifecycle, client sign-off, sample photos, client notification emails.
*Exit criteria: a real client approves a real sample through the system.*

**Phase 4 — Billing (2.5 weeks) — the hard one**
Billable Now, bill creation, the corrected arithmetic, bill lifecycle, client
certification, payments, PDF and Excel export, margin block.
*Exit criteria: a CA has reviewed a generated RA bill and signed off on the tax treatment.*

**Phase 5 — Hardening (1.5 weeks)**
Users & roles admin, audit log UI, full RLS test suite, performance pass, restore drill,
production cutover.

~10 weeks with three developers, assuming the open decisions in §18 are closed in week 1.

---

## 18. Open decisions — I need answers on these

> **All ten answered 2026-09-09 by Voola.** See `decisions.md` for each answer and its schema
> consequence. Two carry an open CA confirmation: D4 (material-at-site as a secured advance) and,
> separately, the five tax questions in §8.4. **D7 came back firmer than the recommendation below**
> — mobilisation advances are tracked, including recoveries and running balance, so Build 09 must
> not treat that ledger as optional.
>
> The questions and recommendations are kept below as the record of what was asked and why. A
> recommendation here is an argument, not an answer.

These block schema work. They are ordered by how much rework they cause if we guess wrong.

| # | Question | Why it matters | My recommendation |
|---|---|---|---|
| **D1** | The earlier Apex spec said "internal use only, no client portal". This UI has a full Client role with bill certification. Which is right? | Changes auth, RLS surface, security posture, and whether we need external-user onboarding | The UI. Client sign-off is the product's differentiator. |
| **D2** | The earlier spec had warehouses, GRNs, purchase orders and WAC costing. This UI has a much simpler inventory. Is the simple model the target, or is this UI Phase 1 of the bigger one? | Determines whether `stock_movements` needs cost layers now or later | Build the simple model, keep the movement ledger so WAC is additive later |
| **D3** | Is this one organisation (Apex Studios) forever, or will you resell it to other contractors? | Multi-tenant isolation is cheap now, expensive to retrofit | Single org, but carry `org_id` on every table from day one |
| **D4** | Is material-at-site billing a **secured advance** (recovered when the material is consumed) or a **sale of goods**? | Different GST treatment, different schema | Secured advance — matches the 75% figure and the "recovery" concept already in your UI |
| **D5** | Should the platform compute TDS (194C) deductions on bills, or leave that to the client's accounts team? | Adds a field and a compliance surface | Show it as an informational line; do not treat it as a liability we track |
| **D6** | Are RA bills raised per-project or per-package? Your UI's Bills table has a "Packages" column implying a bill can span packages. | Affects bill numbering and cumulative arithmetic | Per-project, spanning packages, numbered `RA-{project_code}-{n}` |
| **D7** | Do you need mobilisation advance tracking? | Common in Indian contracts, adds a recovery ledger | Yes if any current contract has one — tell me |
| **D8** | Who is the "Admin" of Apex — is there a Super Admin above the four named staff who alone manages users and billing constants? | Adds a fourth role | Yes, add `owner` — you shouldn't be one careless click from a wrong GST rate |
| **D9** | Does a client ever have more than one project with you? | Affects client portal navigation | Yes almost certainly — design for it |
| **D10** | Staging: the earlier spec excluded it. Do you accept a Supabase preview branch? | Migration safety | Take the preview branch. Billing math should not debut in prod. |

---

## 19. References

- Supabase, *Custom Claims & Role-Based Access Control* —
  https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac
- MakerKit, *Supabase RLS Best Practices* — https://makerkit.dev/blog/tutorials/supabase-rls-best-practices
- TaxGuru, *Retention & Withheld Amount and GST* — https://taxguru.in/goods-and-service-tax/retention-withheld-amount-gst.html
- TaxGuru, *Accounting and GST in Construction Work Contract* — https://taxguru.in/goods-and-service-tax/accounting-gst-construction-work-contract.html
- Site Setu, *RA Bill Format and Process* — https://sitesetu.in/blog/ra-bill-format-process
- Infralens, *Running Account (RA) Bill template structure* — https://infralens.in/pmc/billing/running-account-ra-bill
- Cloudflare R2 + Next.js presigned upload patterns — https://www.buildwithmatija.com/blog/how-to-upload-files-to-cloudflare-r2-nextjs
- AGENTS.md open standard — https://agents.md