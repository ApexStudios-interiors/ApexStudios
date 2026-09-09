-- 0004 — projects and membership
--
-- 02-lld.md §3.2.

create table public.projects (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.orgs(id),
  client_id              uuid not null references public.clients(id),
  code                   text not null,                    -- 'BHEL-NCH', used in bill numbers
  name                   text not null,
  location               text,
  status                 public.project_status not null default 'planning',
  start_date             date not null,
  target_end_date        date,
  contract_value         numeric(14,2) not null default 0,

  -- Billing constants are per project (HLD §5.2, ADR-004). These defaults apply
  -- to new projects only; they are not truths. The values themselves are
  -- CA-gated in Build 09.
  gst_rate_pct           numeric(6,3) not null default 18.000,
  retention_pct          numeric(6,3) not null default 5.000,
  mas_billable_pct       numeric(6,3) not null default 75.000,
  tds_pct                numeric(6,3) not null default 0.000,

  -- D7 (answered yes): mobilisation advances are tracked, with recoveries and a
  -- running balance. Build 09 owns the recovery schedule and per-bill rows;
  -- these two columns are the running totals they maintain.
  mobilisation_advance   numeric(14,2) not null default 0,
  mobilisation_recovered numeric(14,2) not null default 0,

  progress_pct           smallint not null default 0,      -- cached, trigger-maintained
  next_bill_seq          int not null default 1,

  created_at             timestamptz not null default now(),
  created_by             uuid references public.profiles(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles(id),
  deleted_at             timestamptz,

  constraint projects_code_uq unique (org_id, code),
  constraint projects_pct_ck check (
    gst_rate_pct between 0 and 100
    and retention_pct between 0 and 100
    and mas_billable_pct between 0 and 100
    and tds_pct between 0 and 100),
  constraint projects_dates_ck check (target_end_date is null or target_end_date >= start_date),
  constraint projects_progress_ck check (progress_pct between 0 and 100),
  constraint projects_mobilisation_ck check (
    mobilisation_advance >= 0
    and mobilisation_recovered >= 0
    and mobilisation_recovered <= mobilisation_advance)
);

-- next_bill_seq is incremented inside rpc_create_bill under a row lock, which is
-- what makes RA numbering gapless and non-duplicated under concurrency. A
-- count(*) + 1 would race two admins into the same bill number.

create index idx_projects_org_status on public.projects (org_id, status) where deleted_at is null;
create index idx_projects_client on public.projects (client_id) where deleted_at is null;
create index idx_projects_org on public.projects (org_id);

alter table public.projects enable row level security;
alter table public.projects force row level security;

create policy projects_select on public.projects for select to authenticated
  using ( deleted_at is null and public.is_member_of(id) );

create policy projects_insert on public.projects for insert to authenticated
  with check ( org_id = public.auth_org() and public.is_admin() );

create policy projects_update on public.projects for update to authenticated
  using      ( org_id = public.auth_org() and public.is_admin() )
  with check ( org_id = public.auth_org() );

create trigger trg_projects_updated_at before update on public.projects
  for each row execute function public.trg_set_updated_at();

-- ── project_members ──────────────────────────────────────────────────────────
-- owner and admin are implicit members of every project in their org and have
-- no rows here (02-lld.md §3.2). This keeps the common case — a supervisor on
-- 2 of 40 projects — cheap, and the admin case free.
create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  added_at   timestamptz not null default now(),
  added_by   uuid references public.profiles(id),
  primary key (project_id, profile_id)
);

-- is_member_of() runs on every row of every query. Both columns are indexed:
-- project_id by the primary key, profile_id here.
create index idx_project_members_profile on public.project_members (profile_id);

alter table public.project_members enable row level security;
alter table public.project_members force row level security;

create policy pm_select on public.project_members for select to authenticated
  using ( public.is_member_of(project_id) );

create policy pm_insert on public.project_members for insert to authenticated
  with check ( public.is_admin() );

create policy pm_delete on public.project_members for delete to authenticated
  using ( public.is_admin() );
