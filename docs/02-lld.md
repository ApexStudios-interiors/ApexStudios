# Apex Projects — Low-Level Design (LLD)

**Version:** 0.1 (draft)
**Date:** 09 September 2026
**Companion to:** `01-hld.md`

This document is the implementation contract. Schema, constraints, policies, function
signatures, API surface, and the exact arithmetic. If something here contradicts the HLD,
this document wins on detail and the HLD wins on intent.

---

## 1. Conventions

### 1.1 Naming

| Thing | Convention | Example |
|---|---|---|
| Table | `snake_case`, plural | `stock_requests` |
| Column | `snake_case` | `needed_by` |
| Primary key | `id uuid default gen_random_uuid()` | |
| Foreign key | `{singular_table}_id` | `package_id` |
| Enum type | `snake_case`, singular | `stock_request_status` |
| View | `v_{subject}` | `v_package_rollup` |
| Role-scoped view | `v_{subject}_{role}` | `v_package_client` |
| Function | `fn_{verb}_{noun}` | `fn_cost_to_client_factor` |
| RPC (callable) | `rpc_{verb}_{noun}` | `rpc_transition_stock_request` |
| Trigger | `trg_{table}_{event}` | `trg_tasks_after_update` |
| Index | `idx_{table}_{columns}` | `idx_tasks_phase_id` |

### 1.2 Types

| Domain | Postgres type | Reason |
|---|---|---|
| Money (₹) | `numeric(14,2)` | Exact. Never `float`, never `money`. Max ₹99,99,99,99,999.99 |
| Quantity | `numeric(14,3)` | 3dp handles kg, m², litres |
| Percentage | `numeric(6,3)` | 0.000–100.000 |
| Progress | `smallint` 0–100 | Integer percent, matches the UI slider |
| Timestamps | `timestamptz` | Always UTC in storage, rendered IST |
| Dates (business) | `date` | `needed_by`, `bill_date` — no time component |
| Text ids shown to humans | `text` with unique index | `bill_no`, `ref_no` |

### 1.3 Standard columns

Every business table carries:

```sql
id          uuid primary key default gen_random_uuid(),
org_id      uuid not null references public.orgs(id),
created_at  timestamptz not null default now(),
created_by  uuid references public.profiles(id),
updated_at  timestamptz not null default now(),
updated_by  uuid references public.profiles(id),
deleted_at  timestamptz            -- soft delete; NULL = live
```

`updated_at` maintained by a shared `trg_set_updated_at` trigger. Every query and every RLS
policy filters `deleted_at is null` unless explicitly restoring.

### 1.4 Rounding

All money rounds **half-up to 2 decimal places at the point of storage**, never at display.
`fn_money(numeric) returns numeric(14,2)` wraps `round(v, 2)`. Percentages are applied to
already-rounded bases so bill totals reconcile to the penny with any hand-check a CA does.

---

## 2. Enums

```sql
create type app_role            as enum ('owner','admin','site','client');
create type project_status      as enum ('planning','active','on_hold','completed','archived');
create type package_status      as enum ('not_started','design','in_progress','completed');
create type phase_billing_status as enum ('unresolved','billable','billed','paid');
create type stock_request_status as enum ('pending','approved','ordered','delivered','rejected');
create type approval_status     as enum ('pending','approved','rejected');
create type approval_type       as enum ('material_sample','drawing','make_model','milestone','other');
create type bill_status         as enum ('draft','submitted','certified','paid','cancelled');
create type bill_line_source    as enum ('phase','material','manual','adjustment');
create type movement_direction  as enum ('in','out','adjust');
create type attachment_entity   as enum ('approval','daily_update','bill','stock_request','project');
```

`owner` is added per HLD open decision D8 — a single Apex principal who manages users and
per-project billing constants. If D8 comes back "no", `owner` collapses to `admin` with no
schema change.

---

## 3. Schema

### 3.1 Organisation & identity

```sql
create table public.orgs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  legal_name    text,
  gstin         text,
  pan           text,
  address       text,
  logo_r2_key   text,
  created_at    timestamptz not null default now()
);

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  org_id        uuid not null references public.orgs(id),
  full_name     text not null,
  email         text,
  phone         text,
  role          app_role not null default 'site',
  is_active     boolean not null default true,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint profiles_contact_ck check (email is not null or phone is not null)
);
create index idx_profiles_org_role on public.profiles(org_id, role) where deleted_at is null;

create table public.clients (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id),
  name              text not null,
  contact_person    text,
  email             text,
  phone             text,
  gstin             text,
  billing_address   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
```

Avatar initials are derived in the app from `full_name` — not stored. Storing a derivable
value is how it goes stale.

### 3.2 Projects

```sql
create table public.projects (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id),
  client_id           uuid not null references public.clients(id),
  code                text not null,                       -- 'BHEL-NCH', used in bill numbers
  name                text not null,
  location            text,
  status              project_status not null default 'planning',
  start_date          date not null,
  target_end_date     date,
  contract_value      numeric(14,2) not null default 0,     -- headline client-facing figure

  -- billing constants, per project (HLD §5.2)
  gst_rate_pct        numeric(6,3) not null default 18.000,
  retention_pct       numeric(6,3) not null default 5.000,
  mas_billable_pct    numeric(6,3) not null default 75.000,
  tds_pct             numeric(6,3) not null default 0.000,
  mobilisation_advance numeric(14,2) not null default 0,
  mobilisation_recovered numeric(14,2) not null default 0,

  -- cached rollups, maintained by trigger
  progress_pct        smallint not null default 0,
  next_bill_seq       int not null default 1,

  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id),
  deleted_at          timestamptz,

  constraint projects_code_uq unique (org_id, code),
  constraint projects_pct_ck  check (
    gst_rate_pct between 0 and 100 and retention_pct between 0 and 100
    and mas_billable_pct between 0 and 100 and tds_pct between 0 and 100),
  constraint projects_dates_ck check (target_end_date is null or target_end_date >= start_date)
);
create index idx_projects_org_status on public.projects(org_id, status) where deleted_at is null;
create index idx_projects_client on public.projects(client_id) where deleted_at is null;

create table public.project_members (
  project_id  uuid not null references public.projects(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  added_at    timestamptz not null default now(),
  added_by    uuid references public.profiles(id),
  primary key (project_id, profile_id)
);
create index idx_project_members_profile on public.project_members(profile_id);
```

**Membership semantics:** `owner` and `admin` implicitly see every project in their org and
do not need rows here. `site` and `client` see **only** projects they are members of. This
keeps the common case (a supervisor on 2 of 40 projects) cheap and the admin case free.

`next_bill_seq` is incremented inside the bill-creation RPC under a row lock, which is how
we guarantee gapless, non-duplicated RA bill numbers under concurrency. A `count(*)+1` would
race.

### 3.3 Packages, phases, tasks

```sql
create table public.packages (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id),
  project_id        uuid not null references public.projects(id) on delete cascade,
  seq_no            int not null,                            -- 01, 02, 03 in the UI
  name              text not null,
  lead_profile_id   uuid references public.profiles(id),
  allocated_amount  numeric(14,2) not null default 0,         -- client-facing
  internal_amount   numeric(14,2) not null default 0,         -- ADMIN ONLY
  status            package_status not null default 'not_started',
  progress_pct      smallint not null default 0,              -- cached
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id),
  deleted_at        timestamptz,
  constraint packages_seq_uq unique (project_id, seq_no),
  constraint packages_amt_ck check (allocated_amount >= 0 and internal_amount >= 0),
  constraint packages_progress_ck check (progress_pct between 0 and 100)
);
create index idx_packages_project on public.packages(project_id) where deleted_at is null;

create table public.phases (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id),
  project_id        uuid not null references public.projects(id) on delete cascade,
  package_id        uuid not null references public.packages(id) on delete cascade,
  seq_no            int not null,
  name              text not null,
  allocated_amount  numeric(14,2) not null default 0,
  internal_amount   numeric(14,2) not null default 0,         -- ADMIN ONLY
  billing_status    phase_billing_status not null default 'unresolved',
  manual_complete_at timestamptz,                             -- "Mark Complete" for task-less phases
  manual_complete_by uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id),
  deleted_at        timestamptz,
  constraint phases_seq_uq unique (package_id, seq_no)
);
create index idx_phases_package on public.phases(package_id) where deleted_at is null;
create index idx_phases_project_billing on public.phases(project_id, billing_status) where deleted_at is null;

create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid not null references public.projects(id) on delete cascade,
  package_id      uuid not null references public.packages(id) on delete cascade,
  phase_id        uuid not null references public.phases(id) on delete cascade,
  name            text not null,
  owner_profile_id uuid references public.profiles(id),
  start_date      date not null,
  duration_weeks  int not null default 1,
  end_date        date generated always as (start_date + (duration_weeks * 7) - 1) stored,
  progress_pct    smallint not null default 0,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id),
  deleted_at      timestamptz,
  constraint tasks_duration_ck check (duration_weeks between 1 and 104),
  constraint tasks_progress_ck check (progress_pct between 0 and 100)
);
create index idx_tasks_phase on public.tasks(phase_id) where deleted_at is null;
create index idx_tasks_package on public.tasks(package_id) where deleted_at is null;
create index idx_tasks_project_dates on public.tasks(project_id, start_date, end_date) where deleted_at is null;
```

**Change from the prototype:** the Gantt uses a 14-week grid with `start_week` as an
integer. That breaks the moment a project runs past 14 weeks or the project start date
moves. We store **real dates** and derive the week index at render:

```
week_index = floor((task.start_date - project.start_date) / 7)
```

The 14-week viewport becomes a scrolling window over real dates. Same visual, correct data.
`project_id` and `package_id` are denormalised onto `tasks` — not for convenience but so
RLS policies evaluate against an indexed local column instead of a two-join lateral.

### 3.4 Inventory

```sql
create table public.inventory_items (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid references public.projects(id) on delete cascade,  -- NULL = central store
  name            text not null,
  category        text,
  sku             text,
  unit            text not null,                    -- 'bag','sqft','nos','kg','ltr'
  qty_on_hand     numeric(14,3) not null default 0, -- CACHE of stock_movements
  reorder_level   numeric(14,3) not null default 0,
  unit_cost       numeric(14,2) not null default 0, -- ADMIN/SITE only, never client
  location        text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id),
  deleted_at      timestamptz,
  constraint inventory_qty_ck  check (qty_on_hand >= 0),   -- negative stock blocked, no override
  constraint inventory_rl_ck   check (reorder_level >= 0),
  constraint inventory_sku_uq  unique nulls not distinct (org_id, project_id, sku)
);
create index idx_inventory_project on public.inventory_items(project_id) where deleted_at is null;
create index idx_inventory_org_name on public.inventory_items(org_id, name) where deleted_at is null;

create table public.stock_movements (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  project_id        uuid references public.projects(id),
  direction         movement_direction not null,
  qty               numeric(14,3) not null,          -- always positive; direction carries sign
  unit_cost         numeric(14,2) not null default 0,
  ref_type          text,                            -- 'stock_request','adjustment','transfer'
  ref_id            uuid,
  reason            text,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  constraint movements_qty_ck check (qty > 0)
);
create index idx_movements_item on public.stock_movements(inventory_item_id, created_at desc);
create index idx_movements_ref on public.stock_movements(ref_type, ref_id);
```

`stock_movements` is **append-only**. No update, no delete policy exists for any role. A
mistake is corrected with a compensating `adjust` movement carrying a reason. This is the
ledger the nightly reconcile job checks `qty_on_hand` against.

### 3.5 Stock requests

```sql
create table public.stock_requests (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id),
  project_id        uuid not null references public.projects(id) on delete cascade,
  package_id        uuid not null references public.packages(id),
  phase_id          uuid references public.phases(id),
  ref_no            text not null,                     -- 'SR-BHEL-NCH-014'
  inventory_item_id uuid references public.inventory_items(id),  -- null = new material
  material_name     text not null,
  qty               numeric(14,3) not null,
  unit              text not null,
  rate              numeric(14,2),                     -- ADMIN ONLY (internal cost per unit)
  needed_by         date,
  note              text,
  status            stock_request_status not null default 'pending',
  requested_by      uuid not null references public.profiles(id),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  ordered_at        timestamptz,
  delivered_by      uuid references public.profiles(id),
  delivered_at      timestamptz,
  rejected_reason   text,
  billed_on_bill_id uuid references public.bills(id),  -- set when MAS-billed; prevents double-billing
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id),
  deleted_at        timestamptz,
  constraint sr_ref_uq unique (org_id, ref_no),
  constraint sr_qty_ck check (qty > 0),
  constraint sr_reject_ck check (status <> 'rejected' or rejected_reason is not null)
);
create index idx_sr_project_status on public.stock_requests(project_id, status) where deleted_at is null;
create index idx_sr_package on public.stock_requests(package_id) where deleted_at is null;
create index idx_sr_billable on public.stock_requests(project_id)
  where status = 'delivered' and billed_on_bill_id is null and deleted_at is null;

create table public.stock_request_events (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.stock_requests(id) on delete cascade,
  from_status   stock_request_status,
  to_status     stock_request_status not null,
  actor_id      uuid not null references public.profiles(id),
  note          text,
  created_at    timestamptz not null default now()
);
create index idx_sr_events_request on public.stock_request_events(request_id, created_at);
```

The partial index `idx_sr_billable` is what makes the Billable Now query fast — it indexes
exactly the rows that query looks for and nothing else.

### 3.6 Approvals

```sql
create table public.approvals (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid not null references public.projects(id) on delete cascade,
  package_id      uuid not null references public.packages(id),
  phase_id        uuid references public.phases(id),
  ref_no          text not null,                     -- 'AP-BHEL-NCH-007'
  type            approval_type not null,
  item            text not null,
  note            text,
  needed_by       date,
  status          approval_status not null default 'pending',
  requested_by    uuid not null references public.profiles(id),
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  decision_reason text,
  supersedes_id   uuid references public.approvals(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint ap_ref_uq unique (org_id, ref_no),
  constraint ap_reject_ck check (status <> 'rejected' or decision_reason is not null),
  constraint ap_decided_ck check ((status = 'pending') = (decided_at is null))
);
create index idx_ap_project_status on public.approvals(project_id, status) where deleted_at is null;
```

`ap_decided_ck` is worth noting: it makes "resolved but no decision timestamp" and "pending
but decided" both unrepresentable. Constraints that make invalid states impossible are
cheaper than the tests that would otherwise catch them.

### 3.7 Daily updates

```sql
create table public.daily_updates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id),
  project_id    uuid not null references public.projects(id) on delete cascade,
  package_id    uuid not null references public.packages(id),
  update_date   date not null default current_date,
  body          text not null,
  author_id     uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index idx_du_project_date on public.daily_updates(project_id, update_date desc) where deleted_at is null;
create index idx_du_package_date on public.daily_updates(package_id, update_date desc) where deleted_at is null;
```

Daily updates are editable by their author for 24 hours, then frozen. They are site-diary
evidence and back up RA bills; a supervisor should be able to fix a typo, and nobody should
be able to rewrite history three months later during a dispute.

### 3.8 Billing

```sql
create table public.bills (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.orgs(id),
  project_id            uuid not null references public.projects(id),
  seq_no                int not null,                   -- 1, 2, 3...
  bill_no               text not null,                  -- 'RA-BHEL-NCH-03'
  bill_date             date not null default current_date,
  period_from           date,
  period_to             date,
  status                bill_status not null default 'draft',
  revision              int not null default 1,

  -- arithmetic (HLD §8.4). All stored, never recomputed on read.
  work_value            numeric(14,2) not null default 0,  -- A
  material_value        numeric(14,2) not null default 0,  -- B
  gross_amount          numeric(14,2) not null default 0,  -- C = A + B
  mas_recovery_amount   numeric(14,2) not null default 0,  -- D
  taxable_amount        numeric(14,2) not null default 0,  -- E = C - D
  gst_amount            numeric(14,2) not null default 0,  -- F
  invoice_total         numeric(14,2) not null default 0,  -- G = E + F
  retention_amount      numeric(14,2) not null default 0,  -- H
  tds_amount            numeric(14,2) not null default 0,  -- I
  advance_recovery      numeric(14,2) not null default 0,  -- J
  net_payable           numeric(14,2) not null default 0,  -- K

  -- rates snapshotted at creation, so a later project-level change
  -- never silently restates an issued bill
  gst_rate_pct          numeric(6,3) not null,
  retention_pct         numeric(6,3) not null,
  tds_pct               numeric(6,3) not null,

  -- ADMIN ONLY
  internal_cost_amount  numeric(14,2) not null default 0,
  margin_amount         numeric(14,2) not null default 0,

  notes                 text,
  created_by            uuid not null references public.profiles(id),
  submitted_at          timestamptz,
  submitted_by          uuid references public.profiles(id),
  certified_at          timestamptz,
  certified_by          uuid references public.profiles(id),
  certification_note    text,
  paid_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  constraint bills_no_uq  unique (org_id, bill_no),
  constraint bills_seq_uq unique (project_id, seq_no)
);
create index idx_bills_project_status on public.bills(project_id, status) where deleted_at is null;

create table public.bill_lines (
  id              uuid primary key default gen_random_uuid(),
  bill_id         uuid not null references public.bills(id) on delete cascade,
  source_type     bill_line_source not null,
  source_id       uuid,                              -- phase_id or stock_request_id
  description     text not null,
  client_value    numeric(14,2) not null,            -- full client-side value of the item
  pct_billed      numeric(6,3) not null default 100, -- 100 for phases, mas_billable_pct for material
  amount          numeric(14,2) not null,            -- client_value * pct / 100
  internal_cost   numeric(14,2) not null default 0,  -- ADMIN ONLY
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index idx_bill_lines_bill on public.bill_lines(bill_id, sort_order);
create unique index idx_bill_lines_source
  on public.bill_lines(source_type, source_id)
  where source_id is not null;
```

**`idx_bill_lines_source` is the double-billing guard.** A phase or a delivered material can
appear on exactly one bill line across the entire system. If an Admin tries to bill the same
completed phase twice, the insert fails at the database, not at a code path someone might
forget to write. (Cancelled bills release their lines by deleting them, which is the one
place we hard-delete — deliberately, so the unique index frees up.)

```sql
create table public.bill_events (
  id            uuid primary key default gen_random_uuid(),
  bill_id       uuid not null references public.bills(id) on delete cascade,
  from_status   bill_status,
  to_status     bill_status not null,
  actor_id      uuid not null references public.profiles(id),
  note          text,
  created_at    timestamptz not null default now()
);

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id),
  bill_id       uuid not null references public.bills(id),
  amount        numeric(14,2) not null,
  paid_on       date not null,
  mode          text,                                -- 'neft','cheque','upi','rtgs'
  reference_no  text,
  note          text,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  constraint payments_amt_ck check (amount > 0)
);
create index idx_payments_bill on public.payments(bill_id);
```

Payments are a separate table rather than a `paid_amount` column because part-payment is
normal in Indian construction. Outstanding = `Σ bills.net_payable (certified/paid) −
Σ payments.amount`.

### 3.9 Attachments & audit

```sql
create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id),
  project_id    uuid references public.projects(id) on delete cascade,
  entity_type   attachment_entity not null,
  entity_id     uuid not null,
  r2_key        text not null unique,
  thumb_r2_key  text,
  file_name     text not null,
  mime_type     text not null,
  size_bytes    bigint not null,
  uploaded_by   uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint att_size_ck check (size_bytes > 0 and size_bytes <= 26214400)  -- 25 MB
);
create index idx_att_entity on public.attachments(entity_type, entity_id) where deleted_at is null;
create index idx_att_project on public.attachments(project_id) where deleted_at is null;

create table public.audit_log (
  id            bigserial primary key,
  org_id        uuid not null,
  actor_id      uuid,
  actor_role    app_role,
  entity_type   text not null,
  entity_id     uuid,
  action        text not null,          -- 'insert','update','delete','transition','impersonate'
  before        jsonb,
  after         jsonb,
  ip            inet,
  created_at    timestamptz not null default now()
);
create index idx_audit_entity on public.audit_log(entity_type, entity_id, created_at desc);
create index idx_audit_actor on public.audit_log(actor_id, created_at desc);
```

`audit_log` is append-only and has **no update or delete policy for any role, including
owner.** It is partitioned by month once it passes ~5M rows.

### 3.10 Background jobs

```sql
create type job_status as enum ('pending','running','succeeded','failed');

create table public.jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references public.orgs(id),
  name            text not null,                    -- 'backup.nightly','attachment.thumbnail'
  status          job_status not null default 'pending',
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text,                             -- dedupes enqueues for the same entity
  attempts        int not null default 0,
  max_attempts    int not null default 5,
  run_after       timestamptz not null default now(),
  lease_until     timestamptz,                      -- set on claim; expiry means the worker died
  last_error      text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint jobs_idem_uq unique nulls not distinct (name, idempotency_key)
);
create index idx_jobs_claimable on public.jobs(run_after)
  where status = 'pending';
create index idx_jobs_expired on public.jobs(lease_until)
  where status = 'running';
create index idx_jobs_failed on public.jobs(name, finished_at desc)
  where status = 'failed';
```

`jobs_idem_uq` means enqueuing a thumbnail twice for the same attachment is a no-op rather
than a duplicate render. The three partial indexes cover exactly the three queries the runner
makes and index nothing else.

**Claim function** — the whole concurrency story is in the one `skip locked` clause:

```sql
create or replace function public.rpc_claim_jobs(
  p_names text[], p_limit int default 5, p_lease interval default '5 minutes'
) returns setof public.jobs
language sql security definer set search_path = '' as $$
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         started_at = now(),
         lease_until = now() + p_lease
   where j.id in (
     select id from public.jobs
      where status = 'pending' and run_after <= now() and name = any(p_names)
      order by run_after
      for update skip locked
      limit p_limit
   )
  returning j.*;
$$;
```

Two overlapping cron invocations do not block each other and do not double-run a job: the
second simply skips the rows the first has locked.

**Completion:**

```sql
create or replace function public.rpc_finish_job(
  p_id uuid, p_ok boolean, p_error text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.jobs set
    status = case
      when p_ok then 'succeeded'
      when attempts >= max_attempts then 'failed'      -- terminal; surfaced to Admin
      else 'pending' end,
    -- exponential backoff: 1m, 2m, 4m, 8m, 16m
    run_after   = case when p_ok then run_after
                       else now() + (power(2, attempts) * interval '1 minute') end,
    lease_until = null,
    last_error  = p_error,
    finished_at = case when p_ok or attempts >= max_attempts then now() end
  where id = p_id;
end; $$;
```

**Reaper** (hourly) returns jobs whose worker died mid-run:

```sql
update public.jobs
   set status = 'pending', lease_until = null,
       last_error = 'lease expired — worker timed out'
 where status = 'running' and lease_until < now();
```

**RLS:** `select` for `is_admin()` only (the Admin ops page lists failures); **no** insert,
update or delete policy for any role — the runner and the enqueue helpers are `security
definer`. A user cannot schedule work.

**Cron registration** (`vercel.json`):

```json
{ "crons": [
  { "path": "/api/cron/jobs.drain",          "schedule": "* * * * *"   },
  { "path": "/api/cron/backup.nightly",      "schedule": "30 19 * * *" },
  { "path": "/api/cron/inventory.reconcile", "schedule": "30 20 * * *" },
  { "path": "/api/cron/jobs.reap",           "schedule": "0 * * * *"   },
  { "path": "/api/cron/weekly.maintenance",  "schedule": "0 21 * * 0"  }
]}
```

Vercel Cron schedules are **UTC**. `30 19` UTC is 01:00 IST — get this wrong and the backup
runs in the middle of the working day. The route handler rejects any request without
`Authorization: Bearer ${CRON_SECRET}`.

---

---

## 4. Views

### 4.1 Rollups

```sql
create view public.v_package_rollup as
select
  p.id as package_id,
  p.project_id,
  p.allocated_amount,
  p.internal_amount,
  coalesce(c.committed, 0)                          as committed,
  p.internal_amount - coalesce(c.committed, 0)      as remaining,
  case when p.internal_amount > 0
       then round(coalesce(c.committed,0) / p.internal_amount * 100, 2)
       else 0 end                                   as used_pct,
  coalesce(t.progress, 0)                           as progress_pct,
  (p.internal_amount > 0 and coalesce(c.committed,0) > p.internal_amount) as is_over_budget
from public.packages p
left join lateral (
  select sum(sr.qty * coalesce(sr.rate,0)) as committed
  from public.stock_requests sr
  where sr.package_id = p.id
    and sr.status in ('approved','ordered','delivered')
    and sr.deleted_at is null
) c on true
left join lateral (
  select case when sum(tk.duration_weeks) > 0
              then round(sum(tk.duration_weeks * tk.progress_pct)::numeric
                         / sum(tk.duration_weeks), 0)
              else 0 end as progress
  from public.tasks tk
  where tk.package_id = p.id and tk.deleted_at is null
) t on true
where p.deleted_at is null;
```

```sql
create view public.v_phase_billing as
select
  ph.id as phase_id, ph.project_id, ph.package_id, ph.name,
  ph.allocated_amount, ph.internal_amount, ph.billing_status,
  count(tk.id)                                        as task_count,
  count(tk.id) filter (where tk.progress_pct = 100)    as tasks_done,
  (   (count(tk.id) > 0 and count(tk.id) = count(tk.id) filter (where tk.progress_pct = 100))
   or ph.manual_complete_at is not null )              as is_complete
from public.phases ph
left join public.tasks tk on tk.phase_id = ph.id and tk.deleted_at is null
where ph.deleted_at is null
group by ph.id;
```

```sql
create view public.v_inventory_status as
select i.*,
  case when i.qty_on_hand = 0                     then 'critical'
       when i.qty_on_hand < i.reorder_level        then 'low'
       else 'ok' end                               as stock_status,
  round(i.qty_on_hand * i.unit_cost, 2)            as stock_value
from public.inventory_items i
where i.deleted_at is null;
```

### 4.2 Billable Now

```sql
create view public.v_billable_now as
-- completed phases not yet on a bill
select
  ph.project_id,
  'phase'::bill_line_source            as source_type,
  ph.id                                as source_id,
  pk.name || ' — ' || ph.name          as description,
  ph.allocated_amount                  as client_value,
  100::numeric(6,3)                    as pct_billed,
  ph.allocated_amount                  as amount,
  ph.internal_amount                   as internal_cost
from public.phases ph
join public.packages pk on pk.id = ph.package_id
join public.v_phase_billing vb on vb.phase_id = ph.id
where ph.deleted_at is null
  and vb.is_complete
  and ph.billing_status in ('unresolved','billable')
  and not exists (select 1 from public.bill_lines bl
                  where bl.source_type = 'phase' and bl.source_id = ph.id)

union all

-- delivered materials not yet billed (secured advance at mas_billable_pct)
select
  sr.project_id,
  'material'::bill_line_source,
  sr.id,
  sr.material_name || ' (' || sr.qty || ' ' || sr.unit || ')',
  round(sr.qty * coalesce(sr.rate,0) * public.fn_cost_to_client_factor(sr.phase_id, sr.package_id), 2),
  pr.mas_billable_pct,
  round(sr.qty * coalesce(sr.rate,0) * public.fn_cost_to_client_factor(sr.phase_id, sr.package_id)
        * pr.mas_billable_pct / 100, 2),
  round(sr.qty * coalesce(sr.rate,0), 2)
from public.stock_requests sr
join public.projects pr on pr.id = sr.project_id
where sr.deleted_at is null
  and sr.status = 'delivered'
  and sr.billed_on_bill_id is null;
```

### 4.3 Role-scoped views (column isolation — HLD §7 Layer 2)

```sql
create view public.v_package_client
with (security_invoker = off) as
select id, project_id, seq_no, name, lead_profile_id,
       allocated_amount as contract_value,
       status, progress_pct
from public.packages
where deleted_at is null and public.is_member_of(project_id);

create view public.v_package_site
with (security_invoker = off) as
select p.id, p.project_id, p.seq_no, p.name, p.lead_profile_id,
       p.status, p.progress_pct,
       (select count(*) from public.stock_requests sr
        where sr.package_id = p.id and sr.status = 'pending' and sr.deleted_at is null)
         as open_requests,
       (select count(*) from public.phases ph
        where ph.package_id = p.id and ph.deleted_at is null) as phase_count
from public.packages p
where p.deleted_at is null and public.is_member_of(p.project_id);
```

Equivalent `v_bill_client`, `v_phase_client`, `v_inventory_site` follow the same pattern.
**The rule: if a column would be a permission violation for that role, it does not appear in
the view's select list.**

### 4.4 Notifications

```sql
create view public.v_notifications as
select 'stock_request' as kind, sr.id as entity_id, sr.project_id,
       'Pending stock request: ' || sr.material_name as title,
       '/projects/' || sr.project_id || '/stock' as href,
       sr.created_at, array['owner','admin','site']::app_role[] as for_roles
from public.stock_requests sr
where sr.status = 'pending' and sr.deleted_at is null

union all
select 'bill_submitted', b.id, b.project_id,
       'Bill ' || b.bill_no || ' awaiting certification',
       '/projects/' || b.project_id || '/billing', b.submitted_at,
       array['owner','admin','client']::app_role[]
from public.bills b where b.status = 'submitted' and b.deleted_at is null

union all
select 'approval_pending', a.id, a.project_id,
       'Approval needed: ' || a.item,
       '/projects/' || a.project_id || '/approvals', a.created_at,
       array['client']::app_role[]
from public.approvals a where a.status = 'pending' and a.deleted_at is null

union all
select 'inventory_low', i.id, i.project_id,
       i.name || ' is ' || v.stock_status,
       coalesce('/projects/' || i.project_id || '/inventory', '/inventory'), now(),
       array['owner','admin','site']::app_role[]
from public.v_inventory_status v join public.inventory_items i on i.id = v.id
where v.stock_status in ('low','critical');
```

The app filters by `auth_role() = any(for_roles)` and membership. One definition serves the
bell, the digest email and any future push notification.

---

## 5. Functions

### 5.1 Auth helpers

```sql
create or replace function public.auth_role() returns app_role
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'app_role')::public.app_role,
    (select role from public.profiles where id = auth.uid())
  );
$$;

create or replace function public.auth_org() returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid,
    (select org_id from public.profiles where id = auth.uid())
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.auth_role() in ('owner','admin');
$$;

create or replace function public.is_member_of(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
      or exists (select 1 from public.project_members m
                 where m.project_id = p_project_id and m.profile_id = auth.uid());
$$;
```

The `coalesce` fallback to a table read means the system still works correctly if the auth
hook is misconfigured — it degrades to slower, not to insecure.

### 5.2 Custom Access Token hook

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
declare claims jsonb; p record;
begin
  select role, org_id into p from public.profiles where id = (event->>'user_id')::uuid;
  claims := event->'claims';
  claims := jsonb_set(claims, '{app_metadata,app_role}', to_jsonb(coalesce(p.role::text,'site')));
  claims := jsonb_set(claims, '{app_metadata,org_id}',   to_jsonb(p.org_id::text));
  return jsonb_set(event, '{claims}', claims);
end;
$$;
```

Registered under Authentication → Hooks. **On any role change the application must call
`auth.admin.signOut(userId, 'global')`** to revoke refresh tokens, or the stale claim
persists for the token lifetime. Access token TTL: 1800s.

### 5.3 Cost→client factor

```sql
create or replace function public.fn_cost_to_client_factor(p_phase_id uuid, p_package_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when ph.internal_amount > 0
                 then ph.allocated_amount / ph.internal_amount end
     from public.phases ph where ph.id = p_phase_id),
    (select case when pk.internal_amount > 0
                 then pk.allocated_amount / pk.internal_amount end
     from public.packages pk where pk.id = p_package_id),
    1.0
  );
$$;
```

Falls back phase → package → 1.0. A factor of 1.0 means "we have no margin data, bill at
cost" — visibly wrong on screen, which is better than silently inventing a margin.

### 5.4 RPC: stock request transition

```sql
create or replace function public.rpc_transition_stock_request(
  p_request_id uuid,
  p_to_status  stock_request_status,
  p_note       text default null
) returns public.stock_requests
language plpgsql security definer set search_path = '' as $$
declare r public.stock_requests; v_role public.app_role; v_item uuid;
begin
  v_role := public.auth_role();

  -- lock the row: this is what makes concurrent transitions safe
  select * into r from public.stock_requests
   where id = p_request_id and deleted_at is null for update;
  if not found then raise exception 'SR_NOT_FOUND' using errcode='P0002'; end if;
  if not public.is_member_of(r.project_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;

  -- legality of the transition
  if not ( (r.status='pending'  and p_to_status in ('approved','rejected'))
        or (r.status='approved' and p_to_status = 'ordered')
        or (r.status='ordered'  and p_to_status = 'delivered') ) then
     raise exception 'ILLEGAL_TRANSITION_%_TO_%', r.status, p_to_status using errcode='23514';
  end if;

  -- who may perform it
  if p_to_status in ('approved','rejected','ordered') and not public.is_admin() then
     raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_to_status = 'delivered' and v_role not in ('owner','admin','site') then
     raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_to_status = 'rejected' and coalesce(p_note,'') = '' then
     raise exception 'REASON_REQUIRED' using errcode='23514';
  end if;

  update public.stock_requests set
    status          = p_to_status,
    approved_by     = case when p_to_status='approved'  then auth.uid() else approved_by end,
    approved_at     = case when p_to_status='approved'  then now()      else approved_at end,
    ordered_at      = case when p_to_status='ordered'   then now()      else ordered_at end,
    delivered_by    = case when p_to_status='delivered' then auth.uid() else delivered_by end,
    delivered_at    = case when p_to_status='delivered' then now()      else delivered_at end,
    rejected_reason = case when p_to_status='rejected'  then p_note     else rejected_reason end,
    updated_at = now(), updated_by = auth.uid()
  where id = p_request_id returning * into r;

  -- stock effect on delivery
  if p_to_status = 'delivered' then
    v_item := r.inventory_item_id;
    if v_item is null then
      insert into public.inventory_items(org_id, project_id, name, unit, qty_on_hand, unit_cost, created_by)
      values (r.org_id, r.project_id, r.material_name, r.unit, 0, coalesce(r.rate,0), auth.uid())
      returning id into v_item;
      update public.stock_requests set inventory_item_id = v_item where id = r.id;
    end if;

    insert into public.stock_movements(org_id, inventory_item_id, project_id, direction,
                                       qty, unit_cost, ref_type, ref_id, created_by)
    values (r.org_id, v_item, r.project_id, 'in', r.qty, coalesce(r.rate,0),
            'stock_request', r.id, auth.uid());

    update public.inventory_items
       set qty_on_hand = qty_on_hand + r.qty, updated_at = now()
     where id = v_item;
  end if;

  insert into public.stock_request_events(request_id, from_status, to_status, actor_id, note)
  values (r.id, r.status, p_to_status, auth.uid(), p_note);

  perform public.fn_audit('stock_request', r.id, 'transition',
                          jsonb_build_object('status', r.status),
                          jsonb_build_object('status', p_to_status));
  return r;
end; $$;
```

Note `for update` on line 1 of the body. Two supervisors tapping "Delivered" simultaneously:
the second waits, re-reads `status = 'delivered'`, and fails the legality check. No double
stock.

### 5.5 RPC: create bill

```sql
create or replace function public.rpc_create_bill(
  p_project_id uuid,
  p_lines      jsonb,        -- [{source_type, source_id}, ...] selected in Billable Now
  p_bill_date  date default current_date,
  p_notes      text default null
) returns public.bills
```

Pseudo-implementation:

```
1.  assert is_admin(); assert is_member_of(project_id)
2.  select * from projects where id = p_project_id for update    -- locks next_bill_seq
3.  materialise the selected rows from v_billable_now, filtered to p_lines
    → raise NOTHING_SELECTED if empty
    → raise ALREADY_BILLED if any source_id already has a bill_line
4.  work_value     := Σ amount where source_type='phase'
    material_value := Σ amount where source_type='material'
    gross          := work_value + material_value
5.  mas_recovery   := Σ prior material bill_lines whose stock_request.phase_id is in the
                      set of phases being billed as completed in step 3
                      (this is the double-billing recovery: we advanced 75% on the material,
                       now the phase containing it is billed in full)
6.  taxable        := gross - mas_recovery
    gst            := round(taxable * projects.gst_rate_pct / 100, 2)
    invoice_total  := taxable + gst
    retention      := round(taxable * projects.retention_pct / 100, 2)
    tds            := round(taxable * projects.tds_pct / 100, 2)
    adv_recovery   := least(remaining mobilisation advance, taxable * recovery_rate)
    net_payable    := invoice_total - retention - tds - adv_recovery
7.  internal_cost  := Σ internal_cost of lines;  margin := taxable - internal_cost
8.  bill_no        := 'RA-' || projects.code || '-' || lpad(seq::text, 2, '0')
    update projects set next_bill_seq = next_bill_seq + 1
9.  insert bills (snapshotting gst_rate_pct, retention_pct, tds_pct from the project)
    insert bill_lines
    update phases  set billing_status = 'billed' for phase lines
    update stock_requests set billed_on_bill_id = bill.id for material lines
10. insert bill_events (null → 'draft'); fn_audit(...)
```

Steps 2 and 8 together are why bill numbers are gapless: the project row lock serialises
bill creation for that project.

### 5.6 RPC: bill transition

```sql
create or replace function public.rpc_transition_bill(
  p_bill_id uuid, p_to_status bill_status, p_note text default null
) returns public.bills
```

| From | To | Who | Extra |
|---|---|---|---|
| draft | submitted | admin/owner | Triggers `bill.generate-pdf`; freezes lines |
| draft | cancelled | admin/owner | Deletes `bill_lines`, resets phases to `billable`, clears `billed_on_bill_id` |
| submitted | certified | **client only** | Records `certified_by`, `certified_at` |
| submitted | draft | client only | Rejection; reason mandatory; `revision += 1` |
| certified | paid | admin/owner | Requires `Σ payments >= net_payable` |

Any other pair raises `ILLEGAL_TRANSITION`. Admin attempting `submitted → certified` raises
`FORBIDDEN` — this is the constraint that gives client certification its meaning.

### 5.7 Other RPCs

| Function | Signature | Notes |
|---|---|---|
| `rpc_set_task_progress` | `(task_id uuid, pct smallint)` | Admin/site. Recomputes package + project progress, flips phase to `billable` when all tasks hit 100 |
| `rpc_mark_phase_complete` | `(phase_id uuid)` | Admin only. Only permitted when `task_count = 0` |
| `rpc_decide_approval` | `(approval_id uuid, decision approval_status, reason text)` | **Client only.** Reason mandatory on reject |
| `rpc_adjust_inventory` | `(item_id uuid, new_qty numeric, reason text)` | Admin only. Writes an `adjust` movement for the delta |
| `rpc_record_payment` | `(bill_id uuid, amount numeric, paid_on date, mode text, ref text)` | Admin. Auto-transitions bill to `paid` when fully covered |
| `fn_audit` | `(entity_type text, entity_id uuid, action text, before jsonb, after jsonb)` | Called inside every mutating RPC |

---

## 6. RLS policies

Enabled on **every** table:

```sql
alter table public.<t> enable row level security;
alter table public.<t> force row level security;   -- applies to table owner too
```

### 6.1 Policy matrix

| Table | select | insert | update | delete |
|---|---|---|---|---|
| `orgs` | own org | — | owner | — |
| `profiles` | own org | admin | self (name/phone) · admin (all) | — |
| `clients` | admin | admin | admin | — |
| `projects` | `is_member_of(id)` | admin | admin | — |
| `project_members` | `is_member_of(project_id)` | admin | — | admin |
| `packages` | **`is_admin()` only** — others via views | admin | admin | — |
| `phases` | **`is_admin()` only** | admin | admin | — |
| `tasks` | `is_member_of(project_id)` | admin, site | admin, site | admin |
| `inventory_items` | `role in (owner,admin,site)` and member | admin | via RPC only | — |
| `stock_movements` | `role in (owner,admin,site)` and member | **none** (RPC only) | **none** | **none** |
| `stock_requests` | **`is_admin()` only** — site via view | admin, site | via RPC only | — |
| `approvals` | `is_member_of(project_id)` | admin, site | via RPC only | — |
| `daily_updates` | `is_member_of(project_id)` | admin, site | author, < 24h | — |
| `bills` | **`is_admin()` only** — client via view | via RPC only | via RPC only | — |
| `bill_lines` | **`is_admin()` only** | via RPC only | **none** | via RPC only |
| `payments` | `is_admin()` | admin | — | — |
| `attachments` | `is_member_of(project_id)` | member | — | uploader, < 24h |
| `audit_log` | `is_admin()` | **none** (definer only) | **none** | **none** |

"via RPC only" means no policy grants the operation to `authenticated`; the `security
definer` RPC is the sole path in. That is deliberate: it means the business rules in §5
cannot be bypassed by a direct PostgREST call, even by an authenticated Admin.

### 6.2 Worked examples

```sql
-- tasks: members read, admin+site write
create policy tasks_select on public.tasks for select to authenticated
  using ( deleted_at is null and public.is_member_of(project_id) );

create policy tasks_insert on public.tasks for insert to authenticated
  with check ( public.is_member_of(project_id)
               and public.auth_role() in ('owner','admin','site') );

create policy tasks_update on public.tasks for update to authenticated
  using      ( public.is_member_of(project_id)
               and public.auth_role() in ('owner','admin','site') )
  with check ( public.is_member_of(project_id) );

-- packages: cost columns exist here, so only admin touches the table at all
create policy packages_select_admin on public.packages for select to authenticated
  using ( deleted_at is null and public.is_admin() and org_id = public.auth_org() );

-- daily_updates: author may edit for 24 hours, then frozen
create policy du_update_author on public.daily_updates for update to authenticated
  using ( author_id = auth.uid() and created_at > now() - interval '24 hours' )
  with check ( author_id = auth.uid() );
```

**Every column named in a policy is indexed.** `project_members(profile_id)`,
`projects(org_id)`, and every `project_id` foreign key have indexes specifically because
they are evaluated on every row of every query.

### 6.3 Required pgTAP tests

For each of `owner`, `admin`, `site`, `client`, and for a member vs non-member of a project:

1. `select internal_amount from packages` — **must return zero rows or error for client and
   site.** Not null. Not zero. Nothing.
2. `select * from bills` — client sees only their project's bills via `v_bill_client`,
   direct table select returns nothing.
3. `insert into stock_movements` — must be denied for every role.
4. `update audit_log` — must be denied for every role including owner.
5. `rpc_transition_bill(submitted → certified)` as admin — must raise FORBIDDEN.
6. `rpc_decide_approval` as admin — must raise FORBIDDEN.
7. A site user reading a project they are not a member of — zero rows.

Tests run against a client SDK session, never `supabase db execute`, because the SQL editor
bypasses RLS entirely and will report a broken policy as working.

---

## 7. API surface (Server Actions)

All actions are `next-safe-action` clients with zod input schemas and a role guard in
middleware. Signatures below are the zod input shape.

### Projects

| Action | Input | Guard |
|---|---|---|
| `createProject` | `{ name, clientId, code, location, startDate, packages: string[] }` | admin |
| `updateProject` | `{ id, ...patch }` | admin |
| `setProjectStatus` | `{ id, status }` | admin |
| `addProjectMember` | `{ projectId, profileId }` | admin |

### Packages & phases

| Action | Input | Guard |
|---|---|---|
| `createPackage` | `{ projectId, name, allocatedAmount, internalAmount, leadProfileId }` | admin |
| `updatePackage` | `{ id, name?, allocatedAmount?, internalAmount?, leadProfileId?, status? }` | admin |
| `createPhase` | `{ packageId, name, allocatedAmount, internalAmount }` | admin |
| `markPhaseComplete` | `{ phaseId }` | admin, task-less phases only |

### Schedule

| Action | Input | Guard |
|---|---|---|
| `createTask` | `{ phaseId, name, ownerProfileId, startDate, durationWeeks }` | admin, site |
| `updateTask` | `{ id, name?, startDate?, durationWeeks?, note? }` | admin, site |
| `setTaskProgress` | `{ id, progressPct: 0..100 }` | admin, site |

### Site ops

| Action | Input | Guard |
|---|---|---|
| `postDailyUpdate` | `{ projectId, packageId, updateDate, body, attachmentKeys: string[] ≤4 }` | admin, site |
| `createStockRequest` | `{ projectId, packageId, phaseId?, materialName, qty, unit, neededBy?, note?, rate? }` (`rate` stripped unless admin) | admin, site |
| `transitionStockRequest` | `{ requestId, toStatus, note? }` | RPC enforces |
| `adjustInventory` | `{ itemId, newQty, reason }` | admin |

### Approvals

| Action | Input | Guard |
|---|---|---|
| `requestApproval` | `{ projectId, packageId, phaseId?, type, item, note?, neededBy?, attachmentKeys }` | admin, site |
| `addSamplePhotos` | `{ approvalId, attachmentKeys }` | admin, site; pending only |
| `decideApproval` | `{ approvalId, decision, reason? }` | **client only** |

### Billing

| Action | Input | Guard |
|---|---|---|
| `createBill` | `{ projectId, lines: {sourceType, sourceId}[], billDate, notes? }` | admin |
| `transitionBill` | `{ billId, toStatus, note? }` | RPC enforces |
| `recordPayment` | `{ billId, amount, paidOn, mode, referenceNo }` | admin |
| `uploadBillCopy` | `{ billId, attachmentKeys }` | admin, site |
| `exportBill` | `{ billId, format: 'pdf' \| 'xlsx' }` | pdf: any member · xlsx: admin |

### Files & users

| Action | Input | Guard |
|---|---|---|
| `requestUploadUrl` | `{ entityType, entityId, fileName, mimeType, sizeBytes }` | member |
| `confirmUpload` | `{ key, entityType, entityId, fileName, mimeType, sizeBytes }` | member |
| `getDownloadUrl` | `{ attachmentId }` | member |
| `inviteUser` | `{ fullName, email?, phone?, role, projectIds? }` | admin |
| `setUserRole` | `{ profileId, role }` | owner; revokes refresh tokens |
| `deactivateUser` | `{ profileId }` | owner |
| `retryJob` | `{ jobId }` | admin — resets a `failed` job to `pending` |

**Guard implementation:**

```ts
export const adminAction = actionClient.use(async ({ next, ctx }) => {
  const session = await getSession();
  if (!session) throw new ActionError('UNAUTHENTICATED');
  if (!['owner', 'admin'].includes(session.role)) throw new ActionError('FORBIDDEN');
  return next({ ctx: { ...ctx, session } });
});
```

---

## 8. Frontend structure

### 8.1 Route tree

```
app/
├─ (auth)/
│  ├─ login/page.tsx                 email+password (staff)
│  ├─ client-login/page.tsx          magic link / OTP
│  └─ callback/route.ts
├─ (app)/
│  ├─ layout.tsx                     Sidebar + Header + role context
│  ├─ page.tsx                       All Projects
│  ├─ inventory/page.tsx             business-wide (admin, site)
│  ├─ users/page.tsx                 admin only
│  └─ projects/[projectId]/
│     ├─ layout.tsx                  project nav, role-filtered
│     ├─ page.tsx                    Dashboard
│     ├─ packages/
│     │  ├─ page.tsx
│     │  └─ [moduleId]/
│     │     ├─ page.tsx              redirects to default tab
│     │     ├─ budget/page.tsx       "Phases" label for non-admin
│     │     ├─ schedule/page.tsx
│     │     ├─ updates/page.tsx
│     │     ├─ stock/page.tsx        hidden for client
│     │     └─ billing/page.tsx      admin only
│     ├─ schedule/page.tsx
│     ├─ updates/page.tsx
│     ├─ inventory/page.tsx
│     ├─ stock/page.tsx
│     ├─ approvals/page.tsx
│     └─ billing/page.tsx            "Bills" label for client
└─ api/
   ├─ cron/[job]/route.ts   Bearer CRON_SECRET; dispatches to lib/jobs handlers
   └─ health/route.ts
```

Package tabs are **routes, not local state** — so a bookmarked or shared link lands on the
right tab, and each tab gets its own `loading.tsx` and streaming boundary.

### 8.2 Role gating

One source of truth, used by both the sidebar and the route guards:

```ts
// lib/rbac/nav.ts
export const NAV: NavItem[] = [
  { key: 'dashboard', href: '',            label: 'Dashboard',      roles: ALL },
  { key: 'packages',  href: '/packages',   label: 'Packages',       roles: ALL, expandable: true },
  { key: 'schedule',  href: '/schedule',   label: 'Schedule',       roles: ALL },
  { key: 'updates',   href: '/updates',    label: 'Daily Updates',  roles: ALL },
  { key: 'inventory', href: '/inventory',  label: 'Inventory',      roles: ['owner','admin','site'] },
  { key: 'stock',     href: '/stock',      label: 'Stock Requests', roles: ['owner','admin','site'],
    badge: 'pendingRequests' },
  { key: 'approvals', href: '/approvals',  label: 'Approvals',      roles: ALL,
    badge: (r) => r === 'client' ? 'pendingApprovals' : null },
  { key: 'billing',   href: '/billing',    label: (r) => r === 'client' ? 'Bills' : 'Billing',
    roles: ['owner','admin','client'], badge: (r) => r === 'client' ? 'submittedBills' : null },
];
```

Each protected page also re-asserts server-side. Hiding a nav item is UX; the layout guard
and RLS are the security.

### 8.3 Gantt component

- Renders a scrolling week grid from `project.start_date`, default viewport 14 weeks.
- Grouped by phase, collapsible; month headers; today column highlighted red.
- Task bar fill = `progress_pct`. Dashed outline + late flag when `end_date < today && progress < 100`.
- Click → Task Detail dialog (progress slider, dates, note). **Client gets a read-only toast
  instead**, exactly as in the prototype.
- Virtualised past 100 tasks.
- Drag-to-reschedule is deliberately **not** in v1 — it is a large touch-target problem on
  mobile and a source of accidental data change.

### 8.4 Money formatting

```ts
// lib/money.ts
formatINR(123456)      // '₹1,23,456.00'
formatINRCompact(1250000) // '₹12.50 L'
formatINRCompact(15000000) // '₹1.50 Cr'
```

Compact form on stat tiles only (≥ ₹1,00,000 → L, ≥ ₹1,00,00,000 → Cr). Full precision in
tables and on every bill. Server-computed, passed as pre-formatted strings alongside raw
numbers so server and client never disagree on rounding.

---

## 9. Upload sequence

```
Browser                Server Action              R2              Postgres
   │  requestUploadUrl      │                      │                  │
   ├───────────────────────►│ auth + membership    │                  │
   │                        │ mime/size validation │                  │
   │                        │ presign PUT (5 min) ─┤                  │
   │◄── { url, key } ───────┤                      │                  │
   │                        │                      │                  │
   ├── PUT file ────────────┼─────────────────────►│                  │
   │◄── 200 ────────────────┼──────────────────────┤                  │
   │                        │                      │                  │
   │  confirmUpload(key)    │                      │                  │
   ├───────────────────────►│ HeadObject ─────────►│                  │
   │                        │◄── size, etag ───────┤                  │
   │                        │ insert attachment ───┼─────────────────►│
   │                        │ enqueue thumbnail    │                  │
   │◄── { attachmentId } ───┤                      │                  │
```

Orphan sweep: a weekly cron job lists R2 keys with no matching `attachments` row older
than 24 hours and deletes them.

---

## 10. Error handling

Domain errors are typed and mapped to user-facing copy at the action boundary:

| Code | HTTP-ish | User message |
|---|---|---|
| `UNAUTHENTICATED` | 401 | "Your session expired. Please sign in again." |
| `FORBIDDEN` | 403 | "You don't have permission to do that." |
| `NOT_FOUND` | 404 | "That record no longer exists." |
| `ILLEGAL_TRANSITION` | 409 | "This request has already moved on. Refresh to see the current status." |
| `ALREADY_BILLED` | 409 | "One or more items are already on another bill." |
| `NEGATIVE_STOCK` | 409 | "Not enough stock on hand." |
| `REASON_REQUIRED` | 422 | "Please give a reason." |
| `VALIDATION` | 422 | Field-level messages from zod |

Postgres `errcode` values from the RPCs map onto these. Unmapped exceptions become a generic
message plus a Sentry event with the correlation id shown to the user.

---

## 11. Seed data

`supabase/seed.sql` reproduces the prototype's demo dataset so developers see a familiar
system on `supabase db reset`:

- Org: Apex Studios. Client: T V Rao Housing Pvt Ltd.
- Profiles: John Israel Voola (owner), Suresh K / Prakash R / Meena D (admin), Ravi (site),
  T V Rao (client).
- Project: BHEL Nagnar Club House, with packages Swimming Pool, Facade & Windows, Interiors,
  MEP — each with phases, tasks at varied progress, and at least one phase complete so
  Billable Now is non-empty.
- Stock requests in every one of the five statuses.
- Approvals: pending, approved, rejected.
- Bills: one Draft, one Submitted, one Certified, one Paid.
- Inventory covering all three derived statuses.

Seeds are idempotent and use fixed UUIDs so e2e tests can reference them.

---

## 12. Test matrix

| ID | Area | Assertion |
|---|---|---|
| T-01 | Billing | Taxable value is computed **before** retention is deducted; GST base = taxable |
| T-02 | Billing | MAS recovery prevents a material billed at 75% from being billed again inside its phase |
| T-03 | Billing | Two concurrent `createBill` calls on one project produce sequential, non-duplicate `bill_no` |
| T-04 | Billing | `bill_lines` unique index rejects billing the same phase twice |
| T-05 | Billing | Admin cannot transition `submitted → certified` |
| T-06 | Stock | Two concurrent `delivered` transitions increment stock exactly once |
| T-07 | Stock | `pending → delivered` raises ILLEGAL_TRANSITION |
| T-08 | Stock | Reject without a reason raises REASON_REQUIRED |
| T-09 | Inventory | Adjustment that would make qty negative is rejected |
| T-10 | Inventory | Nightly reconcile detects an injected drift between cache and ledger |
| T-11 | RLS | Client session selecting `packages.internal_amount` returns nothing |
| T-12 | RLS | Site session selecting any bill returns nothing |
| T-13 | RLS | Non-member site user sees zero rows for another project |
| T-14 | RLS | No role can insert into `stock_movements` or update `audit_log` |
| T-15 | Auth | Role change revokes refresh tokens; old JWT no longer grants old role |
| T-16 | Progress | Duration weighting: a 3-week task at 100% + a 1-week at 0% → 75% |
| T-17 | Progress | All tasks in a phase reaching 100% flips `billing_status` to `billable` |
| T-18 | Files | `confirmUpload` for a key that was never PUT fails and writes no row |
| T-19 | Files | Client cannot fetch a download URL for another project's attachment |
| T-20 | Money | `formatINR` produces Indian grouping; L/Cr thresholds correct at boundaries |
| T-21 | Jobs | Two concurrent `rpc_claim_jobs` calls never return the same row |
| T-22 | Jobs | A job exceeding `max_attempts` lands in `failed`, not an infinite retry loop |
| T-23 | Jobs | The reaper requeues a job whose `lease_until` has passed |
| T-24 | Jobs | Enqueuing the same `(name, idempotency_key)` twice creates one row |
| T-25 | Jobs | `/api/cron/*` without the correct `CRON_SECRET` returns 401 |

---

## 13. Implementation order

Follow the HLD phases. Within each, this order:

1. Migration + RLS policies (same file)
2. pgTAP tests for those policies — **before** any UI
3. Drizzle schema sync + generated types
4. `service.ts` + unit tests
5. `queries.ts` (role-shaped)
6. `actions.ts` with guards
7. UI components
8. Playwright journey

Step 2 preceding step 7 is not negotiable. Retrofitting RLS onto a working UI is how
permission bugs reach production, and this system's entire value proposition is that the
client cannot see the margin.