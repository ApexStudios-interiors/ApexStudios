-- 0002 — helper functions
--
-- 02-lld.md §5.1, plus fn_money, fn_audit and trg_set_updated_at.
--
-- Every function here is `security definer` with `set search_path = ''`.
-- That is not stylistic. A security-definer function without it is a privilege
-- escalation: a caller creates a schema earlier in their search path, shadows a
-- table name, and the function runs their table as the definer. The pgTAP suite
-- asserts this on every definer function in the schema, including future ones.
--
-- Because search_path is empty, every reference below is schema-qualified.
--
-- check_function_bodies is disabled for this file only. The helpers reference
-- public.profiles and public.project_members, which migrations 0003 and 0004
-- create; Postgres validates the body of a `language sql` function at creation
-- time and would reject them. The alternative is a circular ordering, because
-- the policies on those very tables call these helpers. Scoped with `set local`
-- so it reverts at the end of the transaction.
set local check_function_bodies = off;

-- ── Money ────────────────────────────────────────────────────────────────────
-- 02-lld.md §1.4: half-up to two decimals at the point of storage.
-- Postgres `round(numeric, int)` is already half-away-from-zero, which is
-- half-up for the non-negative values money takes here.
create or replace function public.fn_money(v numeric)
returns numeric(14,2)
language sql immutable
set search_path = ''
as $$ select round(v, 2)::numeric(14,2) $$;

-- ── Auth helpers ─────────────────────────────────────────────────────────────
-- The coalesce fallback to a table read is deliberate: if the Custom Access
-- Token hook is misconfigured, the system degrades to slower, not to insecure
-- (architecture.md §8.4).
create or replace function public.auth_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'app_role')::public.app_role,
    (select p.role from public.profiles p where p.id = auth.uid())
  );
$$;

create or replace function public.auth_org()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid,
    (select p.org_id from public.profiles p where p.id = auth.uid())
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select public.auth_role() in ('owner', 'admin') $$;

-- Membership semantics (02-lld.md §3.2): owner and admin implicitly see every
-- project in their org and have no project_members rows. site and client see
-- only projects they are members of.
create or replace function public.is_member_of(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_admin()
      or exists (
           select 1 from public.project_members m
            where m.project_id = p_project_id
              and m.profile_id = auth.uid()
         );
$$;

-- ── Shared updated_at trigger ────────────────────────────────────────────────
-- One function, attached by every table that carries updated_at.
create or replace function public.trg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Audit ────────────────────────────────────────────────────────────────────
-- Called from inside every mutating RPC, in the same transaction as the change,
-- so an audit row cannot be lost when the change succeeds. audit_log has no
-- insert policy for any role; this definer function is the only way in.
create or replace function public.fn_audit(
  p_entity_type text,
  p_entity_id   uuid,
  p_action      text,
  p_before      jsonb default null,
  p_after       jsonb default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (org_id, actor_id, actor_role, entity_type, entity_id, action, before, after)
  values (
    public.auth_org(),
    auth.uid(),
    public.auth_role(),
    p_entity_type,
    p_entity_id,
    p_action,
    p_before,
    p_after
  );
end;
$$;
