-- 0003 — orgs, profiles, clients
--
-- 02-lld.md §3.1. Every table here enables RLS, forces it, adds its policies and
-- indexes every column named in a policy — in this file. AGENTS.md database
-- rule 2, no exceptions including for lookup tables: Supabase exposes every
-- public table over PostgREST with the anon key whether the app uses it or not.

-- ── orgs ─────────────────────────────────────────────────────────────────────
create table public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  legal_name  text,
  gstin       text,
  pan         text,
  address     text,
  logo_r2_key text,
  created_at  timestamptz not null default now()
);

alter table public.orgs enable row level security;
alter table public.orgs force row level security;

create policy orgs_select on public.orgs for select to authenticated
  using ( id = public.auth_org() );

-- Only owner edits the org's legal identity: it prints on every tax invoice.
create policy orgs_update on public.orgs for update to authenticated
  using      ( id = public.auth_org() and public.auth_role() = 'owner' )
  with check ( id = public.auth_org() );

-- ── profiles ─────────────────────────────────────────────────────────────────
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  org_id       uuid not null references public.orgs(id),
  full_name    text not null,
  email        text,
  phone        text,
  role         public.app_role not null default 'site',
  is_active    boolean not null default true,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  -- Clients sign in by magic link or phone OTP, staff by email; one of the two
  -- must exist or the account cannot be reached at all.
  constraint profiles_contact_ck check (email is not null or phone is not null)
);

-- Avatar initials are derived from full_name in the app, never stored:
-- a stored derivable value is a value that goes stale.

create index idx_profiles_org_role on public.profiles (org_id, role) where deleted_at is null;
-- auth_org() and every org-scoped policy read org_id.
create index idx_profiles_org on public.profiles (org_id);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create policy profiles_select on public.profiles for select to authenticated
  using ( org_id = public.auth_org() and deleted_at is null );

create policy profiles_insert on public.profiles for insert to authenticated
  with check ( org_id = public.auth_org() and public.is_admin() );

-- A user may edit their own name and phone. Only an admin may edit anyone else.
-- The role column itself is owner-only and is enforced in the RPC that sets it
-- (Build 03), because a column-level rule cannot be expressed in a policy.
create policy profiles_update_self on public.profiles for update to authenticated
  using      ( id = auth.uid() )
  with check ( id = auth.uid() and org_id = public.auth_org() );

create policy profiles_update_admin on public.profiles for update to authenticated
  using      ( org_id = public.auth_org() and public.is_admin() )
  with check ( org_id = public.auth_org() );

create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.trg_set_updated_at();

-- ── clients ──────────────────────────────────────────────────────────────────
create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  name            text not null,
  contact_person  text,
  email           text,
  phone           text,
  gstin           text,
  billing_address text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index idx_clients_org on public.clients (org_id) where deleted_at is null;

alter table public.clients enable row level security;
alter table public.clients force row level security;

-- Admin only. A client user does not read the clients table; their own project
-- reaches them through projects and the role-scoped views.
create policy clients_select on public.clients for select to authenticated
  using ( org_id = public.auth_org() and public.is_admin() and deleted_at is null );

create policy clients_insert on public.clients for insert to authenticated
  with check ( org_id = public.auth_org() and public.is_admin() );

create policy clients_update on public.clients for update to authenticated
  using      ( org_id = public.auth_org() and public.is_admin() )
  with check ( org_id = public.auth_org() );

create trigger trg_clients_updated_at before update on public.clients
  for each row execute function public.trg_set_updated_at();
