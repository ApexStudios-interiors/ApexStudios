-- 0010 — bills, lines, events, payments
--
-- 02-lld.md §3.8. HLD §8.4 fixes the order of operations, and the crucial part
-- of it is that GST is charged on the taxable value BEFORE retention is
-- deducted: under Indian GST retention money is part of the value of the supply
-- even though it has not been received. Deducting retention first understates
-- output GST, which is a liability at assessment. ADR-005.
--
-- Every figure below is stored, never recomputed on read, and the rates are
-- snapshotted at creation so a later change to projects.gst_rate_pct cannot
-- silently restate an issued bill (ADR-006).

create table public.bills (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs(id),
  project_id           uuid not null references public.projects(id),
  seq_no               int not null,
  bill_no              text not null,                  -- 'RA-BHEL-NCH-03' (D6)
  bill_date            date not null default current_date,
  period_from          date,
  period_to            date,
  status               public.bill_status not null default 'draft',
  revision             int not null default 1,

  -- HLD §8.4, step by step.
  work_value           numeric(14,2) not null default 0,  -- A
  material_value       numeric(14,2) not null default 0,  -- B
  gross_amount         numeric(14,2) not null default 0,  -- C = A + B
  mas_recovery_amount  numeric(14,2) not null default 0,  -- D
  taxable_amount       numeric(14,2) not null default 0,  -- E = C - D   ← the GST base
  gst_amount           numeric(14,2) not null default 0,  -- F = E * gst_rate_pct
  invoice_total        numeric(14,2) not null default 0,  -- G = E + F
  retention_amount     numeric(14,2) not null default 0,  -- H
  tds_amount           numeric(14,2) not null default 0,  -- I  (informational, D5)
  advance_recovery     numeric(14,2) not null default 0,  -- J  (mobilisation, D7)
  net_payable          numeric(14,2) not null default 0,  -- K = G - H - I - J

  -- Snapshotted at creation. Never read from projects at render time.
  gst_rate_pct         numeric(6,3) not null,
  retention_pct        numeric(6,3) not null,
  tds_pct              numeric(6,3) not null,

  -- ADMIN ONLY
  internal_cost_amount numeric(14,2) not null default 0,
  margin_amount        numeric(14,2) not null default 0,

  notes                text,
  created_by           uuid not null references public.profiles(id),
  submitted_at         timestamptz,
  submitted_by         uuid references public.profiles(id),
  certified_at         timestamptz,
  certified_by         uuid references public.profiles(id),
  certification_note   text,
  paid_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  constraint bills_no_uq unique (org_id, bill_no),
  constraint bills_seq_uq unique (project_id, seq_no),
  constraint bills_rates_ck check (
    gst_rate_pct between 0 and 100
    and retention_pct between 0 and 100
    and tds_pct between 0 and 100)
);

-- There is deliberately no paid_amount column. Part-payment is normal in Indian
-- construction, so payments is a table. Outstanding is
-- Σ bills.net_payable (certified/paid) − Σ payments.amount.

create index idx_bills_project_status on public.bills (project_id, status) where deleted_at is null;
create index idx_bills_org on public.bills (org_id);

alter table public.bills enable row level security;
alter table public.bills force row level security;

-- Admin only: the internal cost and margin block lives on this row. The client
-- reads their own bills through v_bill_client (0014), which omits both.
create policy bills_select_admin on public.bills for select to authenticated
  using ( deleted_at is null and public.is_admin() and org_id = public.auth_org() );

-- No insert and no update policy for any role. rpc_create_bill and
-- rpc_transition_bill are the only paths in (Build 09). That is what makes
-- "bills are immutable from submitted onward" and "only a client may certify"
-- true even against a direct PostgREST call by an authenticated admin.

create trigger trg_bills_updated_at before update on public.bills
  for each row execute function public.trg_set_updated_at();

-- Deferred from 0007: stock_requests could not reference bills before it existed.
-- This is the other half of the double-billing guard and must not be dropped.
alter table public.stock_requests
  add constraint sr_billed_on_bill_fk
  foreign key (billed_on_bill_id) references public.bills(id);

-- ── bill_lines ───────────────────────────────────────────────────────────────
create table public.bill_lines (
  id            uuid primary key default gen_random_uuid(),
  bill_id       uuid not null references public.bills(id) on delete cascade,
  source_type   public.bill_line_source not null,
  source_id     uuid,                              -- phase_id or stock_request_id
  description   text not null,
  client_value  numeric(14,2) not null,
  pct_billed    numeric(6,3) not null default 100, -- 100 for phases, mas_billable_pct for material
  amount        numeric(14,2) not null,            -- client_value * pct / 100
  internal_cost numeric(14,2) not null default 0,  -- ADMIN ONLY
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  constraint bill_lines_pct_ck check (pct_billed between 0 and 100)
);

create index idx_bill_lines_bill on public.bill_lines (bill_id, sort_order);

-- THE DOUBLE-BILLING GUARD. A phase or a delivered material appears on exactly
-- one bill line across the entire system. If an admin tries to bill the same
-- completed phase twice, the insert fails at the database rather than at a code
-- path someone might forget to write.
--
-- Must be unique, and must be `where source_id is not null` — manual and
-- adjustment lines carry no source and would otherwise collide with each other.
create unique index idx_bill_lines_source
  on public.bill_lines (source_type, source_id)
  where source_id is not null;

alter table public.bill_lines enable row level security;
alter table public.bill_lines force row level security;

create policy bill_lines_select_admin on public.bill_lines for select to authenticated
  using (
    public.is_admin()
    and exists (select 1 from public.bills b
                 where b.id = bill_id and b.org_id = public.auth_org())
  );

-- No insert, update or delete policy. rpc_create_bill writes lines; cancelling a
-- bill hard-deletes its lines — the one deliberate exception to soft delete —
-- so the unique index above frees up again.

-- ── bill_events ──────────────────────────────────────────────────────────────
-- Append-only for every role including owner (ADR-007).
create table public.bill_events (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references public.bills(id) on delete cascade,
  from_status public.bill_status,
  to_status   public.bill_status not null,
  actor_id    uuid not null references public.profiles(id),
  note        text,
  created_at  timestamptz not null default now()
);

create index idx_bill_events_bill on public.bill_events (bill_id, created_at);

alter table public.bill_events enable row level security;
alter table public.bill_events force row level security;

create policy bill_events_select on public.bill_events for select to authenticated
  using (
    exists (select 1 from public.bills b
             where b.id = bill_id
               and b.org_id = public.auth_org()
               and (public.is_admin() or public.is_member_of(b.project_id)))
  );

-- No insert, update or delete policy for any role.

-- ── payments ─────────────────────────────────────────────────────────────────
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id),
  bill_id      uuid not null references public.bills(id),
  amount       numeric(14,2) not null,
  paid_on      date not null,
  mode         text,                                -- 'neft','cheque','upi','rtgs'
  reference_no text,
  note         text,
  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  constraint payments_amt_ck check (amount > 0)
);

create index idx_payments_bill on public.payments (bill_id);
create index idx_payments_org on public.payments (org_id);

alter table public.payments enable row level security;
alter table public.payments force row level security;

create policy payments_select on public.payments for select to authenticated
  using ( org_id = public.auth_org() and public.is_admin() );

create policy payments_insert on public.payments for insert to authenticated
  with check ( org_id = public.auth_org() and public.is_admin() );
