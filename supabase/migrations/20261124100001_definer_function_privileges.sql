-- Security hardening (audit 2026-11-24): who may EXECUTE the helper functions
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and this Supabase
-- project's default privileges grant it to anon and authenticated as well.
-- Each RPC here already revokes that and grants back only what it needs; the
-- helpers below never did, so every one was callable over
-- POST /rest/v1/rpc/<name> by any signed-in user — and by the anon key.
--
-- ── APX-01: fn_cost_to_client_factor ─────────────────────────────────────────
-- SECURITY DEFINER, so it reads phases/packages past their admin-only RLS, and
-- returns allocated ÷ internal. A client who knows a phase's contract value
-- (v_phase_client shows it) could compute its internal cost: the system's
-- central rule, broken by one call.
--
-- It cannot simply be revoked from authenticated: v_billable_now is a
-- security_invoker view, so an ADMIN reading Billable Now calls it with their
-- own privileges. So the function now answers only an admin — anyone else gets
-- NULL — and anon loses EXECUTE outright. rpc_create_bill (definer) is called
-- by an admin and is unaffected.
--
-- ── APX-56: fn_audit, fn_recompute_progress, rpc_check_rate_limit ────────────
--   fn_audit               let any user write an audit row of their choosing.
--   fn_recompute_progress  a write anyone could trigger on any package.
--   Both are only ever called from inside SECURITY DEFINER functions and
--   triggers (owner postgres), which keep their own right to call them, so
--   EXECUTE is revoked from public, anon and authenticated.
--
--   rpc_check_rate_limit   the CALLER chose the window and the maximum, so a
--   caller could reset its own limit by passing a 1-second window. The limits
--   now live here, per action, and the caller names only the action. The old
--   three-argument signature is kept as a thin wrapper that IGNORES the
--   caller's numbers, so a running deployment of the previous app build keeps
--   working (and keeps being throttled) until it is replaced; it is to be
--   dropped in a later migration once nothing calls it.
--
-- ── APX-58: is_member_of is scoped to the caller's organisation ──────────────
-- An admin was an implicit member of EVERY project, in any organisation. Only
-- one organisation exists today, so this changes no answer; it closes the gap
-- before a second one is onboarded. Site and client membership is unchanged
-- (a project_members row), so are the semantics for a NULL role.
--
-- Index note (AGENTS.md database rule 5): the new lookup is projects' primary
-- key; project_members is already indexed on both columns.

-- APX-01 ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_cost_to_client_factor(p_phase_id uuid, p_package_id uuid)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select case when public.is_admin() then
    coalesce(
      (select case when ph.internal_amount > 0
                   then ph.allocated_amount / ph.internal_amount end
         from public.phases ph where ph.id = p_phase_id),
      (select case when pk.internal_amount > 0
                   then pk.allocated_amount / pk.internal_amount end
         from public.packages pk where pk.id = p_package_id),
      1.0
    )
  end;
$$;

comment on function public.fn_cost_to_client_factor(uuid, uuid) is
  'Admin-only answer (NULL for anyone else): the ratio reveals internal cost. Executable by authenticated only because v_billable_now (security_invoker) calls it as the admin reading it. APX-01.';

revoke execute on function public.fn_cost_to_client_factor(uuid, uuid) from public, anon;
grant execute on function public.fn_cost_to_client_factor(uuid, uuid) to authenticated;

-- APX-56 ─────────────────────────────────────────────────────────────────────
revoke execute on function public.fn_audit(text, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.fn_recompute_progress(uuid, uuid) from public, anon, authenticated;

-- The one place a limit is decided. A new throttled action adds a branch here.
create or replace function public.rpc_check_rate_limit(p_action text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_max    int;
  v_window int;
  v_row    public.rate_limits;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: no authenticated user' using errcode = '42501';
  end if;

  case p_action
    -- features/search/run.ts: generous for a debounced human, a wall for a
    -- scripted hammer. Shared by the web header and the mobile API.
    when 'search' then v_max := 20; v_window := 60;
    else
      raise exception 'FORBIDDEN: % has no rate limit defined', p_action using errcode = '42501';
  end case;

  insert into public.rate_limits (profile_id, action, window_start, count)
  values (v_uid, p_action, now(), 1)
  on conflict (profile_id, action) do update
    set window_start = case
          when public.rate_limits.window_start < now() - make_interval(secs => v_window)
            then now()
          else public.rate_limits.window_start
        end,
        count = case
          when public.rate_limits.window_start < now() - make_interval(secs => v_window)
            then 1
          else public.rate_limits.count + 1
        end
  returning * into v_row;

  return v_row.count <= v_max;
end;
$$;

revoke execute on function public.rpc_check_rate_limit(text) from public, anon;
grant execute on function public.rpc_check_rate_limit(text) to authenticated;

-- Deprecated shim: the caller's numbers are ignored. Drop once no deployment
-- calls the three-argument form (features/search/run.ts no longer does).
create or replace function public.rpc_check_rate_limit(
  p_action         text,
  p_max_per_window int,
  p_window_seconds int default 60
) returns boolean
language sql security definer
set search_path = ''
as $$ select public.rpc_check_rate_limit(p_action) $$;

revoke execute on function public.rpc_check_rate_limit(text, int, int) from public, anon;
grant execute on function public.rpc_check_rate_limit(text, int, int) to authenticated;

-- APX-58 ─────────────────────────────────────────────────────────────────────
create or replace function public.is_member_of(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when public.is_admin() then exists (
      select 1 from public.projects p
       where p.id = p_project_id and p.org_id = public.auth_org()
    )
    else exists (
      select 1 from public.project_members m
       where m.project_id = p_project_id and m.profile_id = auth.uid()
    )
  end;
$$;
