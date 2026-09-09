-- 0007 — stock requests and their event log
--
-- 02-lld.md §3.5.
--
-- `rate` is the internal cost per unit, so this table is admin-only on select.
-- Site raises and reads requests through v_stock_request_site (0014), which
-- omits rate. The billed_on_bill_id foreign key is added in 0010, because bills
-- does not exist yet; it is a deferred constraint, not a dropped one — it is
-- the other half of the double-billing guard.

create table public.stock_requests (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id),
  project_id        uuid not null references public.projects(id) on delete cascade,
  package_id        uuid not null references public.packages(id),
  phase_id          uuid references public.phases(id),
  ref_no            text not null,                    -- 'SR-BHEL-NCH-014'
  inventory_item_id uuid references public.inventory_items(id),  -- null = new material
  material_name     text not null,
  qty               numeric(14,3) not null,
  unit              text not null,
  rate              numeric(14,2),                    -- ADMIN ONLY (internal cost per unit)
  needed_by         date,
  note              text,
  status            public.stock_request_status not null default 'pending',
  requested_by      uuid not null references public.profiles(id),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  ordered_at        timestamptz,
  delivered_by      uuid references public.profiles(id),
  delivered_at      timestamptz,
  rejected_reason   text,
  -- Set when MAS-billed. Prevents the same delivered material being billed twice.
  billed_on_bill_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id),
  deleted_at        timestamptz,
  constraint sr_ref_uq unique (org_id, ref_no),
  constraint sr_qty_ck check (qty > 0),
  constraint sr_rate_ck check (rate is null or rate >= 0),
  -- A rejection reason is mandatory at the database, not just in the RPC.
  constraint sr_reject_ck check (status <> 'rejected' or rejected_reason is not null)
);

create index idx_sr_project_status on public.stock_requests (project_id, status) where deleted_at is null;
create index idx_sr_package on public.stock_requests (package_id) where deleted_at is null;
create index idx_sr_org on public.stock_requests (org_id);

-- The partial index that makes Billable Now fast: it indexes exactly the rows
-- that query looks for — delivered and not yet billed — and nothing else.
create index idx_sr_billable on public.stock_requests (project_id)
  where status = 'delivered' and billed_on_bill_id is null and deleted_at is null;

alter table public.stock_requests enable row level security;
alter table public.stock_requests force row level security;

create policy sr_select_admin on public.stock_requests for select to authenticated
  using ( deleted_at is null and public.is_admin() and org_id = public.auth_org() );

create policy sr_insert on public.stock_requests for insert to authenticated
  with check ( public.is_member_of(project_id)
               and public.auth_role() in ('owner', 'admin', 'site')
               and org_id = public.auth_org() );

-- No update policy. Status transitions go through rpc_transition_stock_request
-- (Build 07), which locks the row, re-checks the state machine and writes both
-- the event row and the stock movement in one transaction.

-- ── stock_request_events ─────────────────────────────────────────────────────
create table public.stock_request_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.stock_requests(id) on delete cascade,
  from_status public.stock_request_status,
  to_status   public.stock_request_status not null,
  actor_id    uuid not null references public.profiles(id),
  note        text,
  created_at  timestamptz not null default now()
);

create index idx_sr_events_request on public.stock_request_events (request_id, created_at);

alter table public.stock_request_events enable row level security;
alter table public.stock_request_events force row level security;

create policy sr_events_select on public.stock_request_events for select to authenticated
  using (
    exists (
      select 1 from public.stock_requests sr
       where sr.id = request_id and public.is_member_of(sr.project_id)
    )
  );

-- Append-only. Written by rpc_transition_stock_request only.
