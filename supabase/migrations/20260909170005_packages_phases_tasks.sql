-- 0005 — packages, phases, tasks
--
-- 02-lld.md §3.3.
--
-- packages and phases carry internal_amount, which is the single column the
-- whole product is built to protect. Their select policy is is_admin() only.
-- Every other role reaches them through the role-scoped views in 0014, which
-- omit the cost columns from the select list entirely — not null, not zero,
-- absent. HLD §7 Layer 2.
--
-- Naming: the prototype calls these "modules" and its "packages" are phases
-- here. The domain words win (code-standards §2); Build 04 renames the UI.

create table public.packages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id),
  project_id       uuid not null references public.projects(id) on delete cascade,
  seq_no           int not null,                      -- 01, 02, 03 in the UI
  name             text not null,
  lead_profile_id  uuid references public.profiles(id),
  allocated_amount numeric(14,2) not null default 0,  -- client-facing
  internal_amount  numeric(14,2) not null default 0,  -- ADMIN ONLY
  status           public.package_status not null default 'not_started',
  progress_pct     smallint not null default 0,       -- cached, trigger-maintained
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id),
  deleted_at       timestamptz,
  constraint packages_seq_uq unique (project_id, seq_no),
  constraint packages_amt_ck check (allocated_amount >= 0 and internal_amount >= 0),
  constraint packages_progress_ck check (progress_pct between 0 and 100)
);

create index idx_packages_project on public.packages (project_id) where deleted_at is null;
create index idx_packages_org on public.packages (org_id);

alter table public.packages enable row level security;
alter table public.packages force row level security;

create policy packages_select_admin on public.packages for select to authenticated
  using ( deleted_at is null and public.is_admin() and org_id = public.auth_org() );

create policy packages_insert on public.packages for insert to authenticated
  with check ( org_id = public.auth_org() and public.is_admin() );

create policy packages_update on public.packages for update to authenticated
  using      ( org_id = public.auth_org() and public.is_admin() )
  with check ( org_id = public.auth_org() );

create trigger trg_packages_updated_at before update on public.packages
  for each row execute function public.trg_set_updated_at();

-- ── phases ───────────────────────────────────────────────────────────────────
create table public.phases (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs(id),
  project_id         uuid not null references public.projects(id) on delete cascade,
  package_id         uuid not null references public.packages(id) on delete cascade,
  seq_no             int not null,
  name               text not null,
  allocated_amount   numeric(14,2) not null default 0,
  internal_amount    numeric(14,2) not null default 0,  -- ADMIN ONLY
  billing_status     public.phase_billing_status not null default 'unresolved',
  -- "Mark Complete" for phases that carry no tasks.
  manual_complete_at timestamptz,
  manual_complete_by uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles(id),
  deleted_at         timestamptz,
  constraint phases_seq_uq unique (package_id, seq_no),
  constraint phases_amt_ck check (allocated_amount >= 0 and internal_amount >= 0),
  constraint phases_manual_ck check ((manual_complete_at is null) = (manual_complete_by is null))
);

create index idx_phases_package on public.phases (package_id) where deleted_at is null;
create index idx_phases_project_billing on public.phases (project_id, billing_status) where deleted_at is null;
create index idx_phases_org on public.phases (org_id);

alter table public.phases enable row level security;
alter table public.phases force row level security;

create policy phases_select_admin on public.phases for select to authenticated
  using ( deleted_at is null and public.is_admin() and org_id = public.auth_org() );

create policy phases_insert on public.phases for insert to authenticated
  with check ( org_id = public.auth_org() and public.is_admin() );

create policy phases_update on public.phases for update to authenticated
  using      ( org_id = public.auth_org() and public.is_admin() )
  with check ( org_id = public.auth_org() );

create trigger trg_phases_updated_at before update on public.phases
  for each row execute function public.trg_set_updated_at();

-- ── tasks ────────────────────────────────────────────────────────────────────
-- Real dates, not the prototype's 14-week integer grid, which breaks the moment
-- a project runs past 14 weeks or its start date moves. The grid becomes a
-- scrolling viewport over real dates: week_index = floor((start - project.start)/7).
-- ADR-011.
create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id),
  -- project_id and package_id are denormalised so RLS evaluates against an
  -- indexed local column instead of a two-join lateral on every row.
  project_id       uuid not null references public.projects(id) on delete cascade,
  package_id       uuid not null references public.packages(id) on delete cascade,
  phase_id         uuid not null references public.phases(id) on delete cascade,
  name             text not null,
  owner_profile_id uuid references public.profiles(id),
  start_date       date not null,
  duration_weeks   int not null default 1,
  end_date         date generated always as (start_date + (duration_weeks * 7) - 1) stored,
  progress_pct     smallint not null default 0,
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id),
  deleted_at       timestamptz,
  constraint tasks_duration_ck check (duration_weeks between 1 and 104),
  constraint tasks_progress_ck check (progress_pct between 0 and 100)
);

create index idx_tasks_phase on public.tasks (phase_id) where deleted_at is null;
create index idx_tasks_package on public.tasks (package_id) where deleted_at is null;
create index idx_tasks_project_dates on public.tasks (project_id, start_date, end_date) where deleted_at is null;
create index idx_tasks_org on public.tasks (org_id);

alter table public.tasks enable row level security;
alter table public.tasks force row level security;

-- Members read. tasks carries no money, so unlike packages it is readable by
-- site and client alike.
create policy tasks_select on public.tasks for select to authenticated
  using ( deleted_at is null and public.is_member_of(project_id) );

create policy tasks_insert on public.tasks for insert to authenticated
  with check ( public.is_member_of(project_id)
               and public.auth_role() in ('owner', 'admin', 'site') );

create policy tasks_update on public.tasks for update to authenticated
  using      ( public.is_member_of(project_id)
               and public.auth_role() in ('owner', 'admin', 'site') )
  with check ( public.is_member_of(project_id) );

create policy tasks_delete on public.tasks for delete to authenticated
  using ( public.is_member_of(project_id) and public.is_admin() );

create trigger trg_tasks_updated_at before update on public.tasks
  for each row execute function public.trg_set_updated_at();

-- The denormalised ancestry must stay true or the RLS shortcut becomes a lie.
create or replace function public.trg_tasks_check_ancestry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_package_id uuid; v_project_id uuid;
begin
  select ph.package_id, ph.project_id into v_package_id, v_project_id
    from public.phases ph where ph.id = new.phase_id;

  if v_package_id is null then
    raise exception 'NOT_FOUND: phase % does not exist', new.phase_id;
  end if;
  if new.package_id <> v_package_id or new.project_id <> v_project_id then
    raise exception
      'INVARIANT: task ancestry mismatch — phase % belongs to package %/project %, not %/%',
      new.phase_id, v_package_id, v_project_id, new.package_id, new.project_id;
  end if;
  return new;
end;
$$;

create trigger trg_tasks_ancestry before insert or update of phase_id, package_id, project_id
  on public.tasks
  for each row execute function public.trg_tasks_check_ancestry();
