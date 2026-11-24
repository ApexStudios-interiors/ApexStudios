-- APX-11 — a project's status changes through one audited RPC.
--
-- Until now nothing in the app could move a project out of 'planning':
-- `setProjectStatus` existed with no caller, and it was a plain PostgREST
-- update, so any transition at all (archived → planning, say) would have been
-- accepted and nothing would have recorded who made it.
--
-- The lifecycle (docs/decisions.md, 2026-11-24, Voola):
--
--   planning  → active
--   active    → on_hold | completed
--   on_hold   → active  | completed
--   completed → archived | active      (active = reopen, reason required)
--   archived  → completed               (reopen, reason required)
--
-- Only an admin may call it; a reopen also needs a reason, which goes into the
-- audit row. The `project.archive` job (service_role) keeps archiving
-- completed projects itself — completed → archived is a legal step anyway.
--
-- features/projects/service.ts PROJECT_STATUS_TRANSITIONS is the TypeScript
-- copy the status control offers its choices from; pgTAP
-- (15_project_setup_test.sql) asserts this function agrees with it pair by
-- pair.

create or replace function public.fn_project_status_transition_allowed(
  p_from public.project_status,
  p_to   public.project_status
) returns boolean
language sql immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('planning'::public.project_status,  'active'::public.project_status),
    ('active'::public.project_status,    'on_hold'::public.project_status),
    ('active'::public.project_status,    'completed'::public.project_status),
    ('on_hold'::public.project_status,   'active'::public.project_status),
    ('on_hold'::public.project_status,   'completed'::public.project_status),
    ('completed'::public.project_status, 'archived'::public.project_status),
    ('completed'::public.project_status, 'active'::public.project_status),
    ('archived'::public.project_status,  'completed'::public.project_status)
  );
$$;

-- A reopen walks back from a finished state. Separate from the matrix so the
-- RPC can ask for a reason on exactly these two steps.
create or replace function public.fn_project_status_is_reopen(
  p_from public.project_status,
  p_to   public.project_status
) returns boolean
language sql immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('completed'::public.project_status, 'active'::public.project_status),
    ('archived'::public.project_status,  'completed'::public.project_status)
  );
$$;

create or replace function public.rpc_set_project_status(
  p_project_id uuid,
  p_status     public.project_status,
  p_reason     text default null
) returns public.project_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: only an admin may change a project''s status' using errcode = '42501';
  end if;

  -- `for update`: two admins changing the same project's status at once are
  -- serialised, and the second one's transition is judged against the first
  -- one's result, never against a stale read.
  select * into v_project
    from public.projects
   where id = p_project_id
     and org_id = public.auth_org()
     and deleted_at is null
     for update;
  if not found then
    raise exception 'NOT_FOUND: project %', p_project_id using errcode = 'P0002';
  end if;

  -- Asking for the status it already has is a no-op, not an error: a
  -- double-submitted form must not tell the second click it failed.
  if v_project.status = p_status then
    return p_status;
  end if;

  if not public.fn_project_status_transition_allowed(v_project.status, p_status) then
    raise exception 'ILLEGAL_TRANSITION: a project cannot go from % to %', v_project.status, p_status
      using errcode = '23514';
  end if;

  if public.fn_project_status_is_reopen(v_project.status, p_status) and v_reason is null then
    raise exception 'REASON_REQUIRED: reopening a % project needs a reason', v_project.status
      using errcode = '23514';
  end if;

  -- The status guard below lets this through: inside a security definer
  -- function current_user is the definer, not `authenticated`.
  update public.projects
     set status = p_status,
         updated_by = auth.uid()
   where id = p_project_id;

  perform public.fn_audit(
    'project',
    p_project_id,
    'transition',
    jsonb_build_object('status', v_project.status, 'completed_at', v_project.completed_at),
    jsonb_build_object('status', p_status, 'reason', v_reason)
  );

  return p_status;
end;
$$;

revoke execute on function public.rpc_set_project_status(uuid, public.project_status, text) from public, anon;
grant execute on function public.rpc_set_project_status(uuid, public.project_status, text) to authenticated;

-- ── No status change around the RPC ──────────────────────────────────────────
-- projects_update still lets an admin update the row directly (Edit Project
-- uses it for name, location, dates, contract value and billing constants).
-- This refuses a STATUS change made that way by a signed-in user, so the RPC
-- above — with its transition rule and its audit row — is the only path a
-- person can take. Deliberately security INVOKER: `current_user` is then
-- `authenticated` for a PostgREST caller and the definer inside the RPC. The
-- service_role job and migrations are not `authenticated` and are unaffected.
create or replace function public.trg_projects_status_via_rpc()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and current_user = 'authenticated' then
    raise exception 'ILLEGAL_TRANSITION: change a project''s status with rpc_set_project_status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_projects_status_via_rpc before update of status on public.projects
  for each row execute function public.trg_projects_status_via_rpc();

-- ── completed_at survives archiving ──────────────────────────────────────────
-- Migration 0025's trigger cleared completed_at on every status other than
-- 'completed', archived included, so an archived project forgot when it was
-- finished. Archiving now keeps it. Every other rule is unchanged: becoming
-- completed (from anywhere, an unarchive included — which restarts the
-- twelve-month clock the archive job reads) stamps now(), and a reopen to
-- active clears it.
create or replace function public.trg_projects_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := now();
  elsif new.status = 'archived' then
    new.completed_at := coalesce(old.completed_at, new.completed_at, now());
  elsif new.status is distinct from 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
