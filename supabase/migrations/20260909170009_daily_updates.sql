-- 0009 — daily site updates
--
-- 02-lld.md §3.7.

create table public.daily_updates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  package_id  uuid not null references public.packages(id),
  update_date date not null default current_date,
  body        text not null,
  author_id   uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index idx_du_project_date on public.daily_updates (project_id, update_date desc) where deleted_at is null;
create index idx_du_package_date on public.daily_updates (package_id, update_date desc) where deleted_at is null;
create index idx_du_author on public.daily_updates (author_id);
create index idx_du_org on public.daily_updates (org_id);

alter table public.daily_updates enable row level security;
alter table public.daily_updates force row level security;

create policy du_select on public.daily_updates for select to authenticated
  using ( deleted_at is null and public.is_member_of(project_id) );

create policy du_insert on public.daily_updates for insert to authenticated
  with check ( public.is_member_of(project_id)
               and public.auth_role() in ('owner', 'admin', 'site')
               and author_id = auth.uid()
               and org_id = public.auth_org() );

-- Editable by their author for 24 hours, then frozen. Daily updates are
-- site-diary evidence that backs up RA bills: a supervisor should be able to fix
-- a typo, and nobody should be able to rewrite history three months later during
-- a dispute.
create policy du_update_author on public.daily_updates for update to authenticated
  using      ( author_id = auth.uid() and created_at > now() - interval '24 hours' )
  with check ( author_id = auth.uid() );

create trigger trg_du_updated_at before update on public.daily_updates
  for each row execute function public.trg_set_updated_at();
