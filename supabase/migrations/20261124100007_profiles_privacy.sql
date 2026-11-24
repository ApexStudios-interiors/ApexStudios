-- Security hardening (audit 2026-11-24, APX-36): who may read and edit a
-- profile
--
-- ── Read ─────────────────────────────────────────────────────────────────────
-- profiles_select admitted every row in the caller's organisation, so client A
-- could list client B — another company — with name, email, phone and the
-- username every sign-in is derived from, plus every staff member's details.
--
-- Now a non-admin sees:
--   * themselves;
--   * every admin of their organisation — admins are implicit members of every
--     project (02-lld.md §3.2) and appear on every one as package lead,
--     approval requester, update author;
--   * if they are site: every other site supervisor (staff see staff; the Add
--     Task "Owner" list offers admins and supervisors, features/schedule/
--     actions.ts getOwnerOptions);
--   * anyone they share a project with (a project_members row on the same
--     project) — the people actually named on their screens.
-- An admin still sees the whole organisation. Index: project_members is keyed
-- on (project_id, profile_id) and indexed on profile_id (0004);
-- idx_profiles_org_role covers the role tests.
--
-- RLS cannot hide a column, so an admin's own email/phone stays visible to the
-- people on that admin's projects — a business contact, not a privacy leak.
-- Narrowing columns further would need a view; recorded as a follow-up.
--
-- ── Write ────────────────────────────────────────────────────────────────────
-- profiles_update_self let a user change ANY column of their own row —
-- including email (the sign-in identity) and deleted_at. Role and is_active
-- were already refused by trg_profiles_privilege_guard. A direct self-update
-- may now change only full_name and phone (plus the timestamps the database
-- itself maintains). Nothing in the application updates a profile directly —
-- the admin paths go through rpc_set_user_role / rpc_set_user_active and the
-- auth admin API — so no screen changes. The trigger tests current_user, not
-- the app role: inside a SECURITY DEFINER RPC current_user is the function
-- owner, so the audited RPCs are unaffected; a PostgREST PATCH runs as
-- `authenticated`.

create or replace function public.fn_shares_project(p_profile_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.project_members mine
      join public.project_members theirs on theirs.project_id = mine.project_id
     where mine.profile_id = auth.uid()
       and theirs.profile_id = p_profile_id
  );
$$;

revoke execute on function public.fn_shares_project(uuid) from public, anon;
grant execute on function public.fn_shares_project(uuid) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    org_id = public.auth_org()
    and deleted_at is null
    and (
      public.is_admin()
      or id = auth.uid()
      or role = 'admin'
      or (public.auth_role() = 'site' and role = 'site')
      or public.fn_shares_project(id)
    )
  );

create or replace function public.trg_profiles_self_update_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_free constant text[] := array['full_name', 'phone', 'updated_at', 'last_seen_at'];
begin
  if current_user in ('authenticated', 'anon')
     and old.id = auth.uid()
     and (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
    raise exception 'FORBIDDEN: you may change only your own name and phone here' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_profiles_self_update_guard
  before update on public.profiles
  for each row execute function public.trg_profiles_self_update_guard();
