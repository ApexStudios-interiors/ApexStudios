-- Security hardening (audit 2026-11-24, APX-34): counters, ledgers and task
-- progress can no longer be written around the RPCs
--
-- ── projects: counters and ledger columns ────────────────────────────────────
-- projects_update lets an admin PATCH any column. Four of them are not inputs
-- but the state the RPCs maintain under a row lock:
--   next_bill_seq / next_sr_seq / next_ap_seq   gapless RA / SR / AP numbering
--   mobilisation_recovered                      the advance-recovery ledger
--   progress_pct                                the trigger-maintained rollup
-- A direct write desynchronises them silently (a rewound next_bill_seq
-- collides on bills_seq_uq; a hand-set mobilisation_recovered restates what
-- every later bill recovers). org_id and the created_* columns are identity.
-- And `code` is embedded in every bill number forever (D6): once a project
-- has a bill, its code cannot change, by anyone.
--
-- ── tasks: a direct update may touch only the editable fields ────────────────
-- tasks_update lets admin and site PATCH any column, including progress_pct
-- (skipping rpc_set_task_progress's audit row and its phase billing-status
-- flip) and deleted_at. A direct insert could likewise start a task at 100%.
-- The Edit Task form (features/schedule/tasks.ts updateTaskFor) changes name,
-- start_date, duration_weeks and note; owner_profile_id is the other field a
-- person sets. Those, plus the timestamps the database keeps, are all a direct
-- update may change. Progress moves only through rpc_set_task_progress.
--
-- Both guards test current_user, not the app role. A PostgREST request runs as
-- `authenticated`; inside a SECURITY DEFINER RPC or trigger current_user is
-- the function's owner, so every audited path (rpc_create_bill's next_bill_seq,
-- rpc_set_task_progress, fn_recompute_progress via trg_tasks_after_update, the
-- cancelled-draft mobilisation reversal) is unaffected. The functions below are
-- therefore deliberately NOT security definer.
--
-- ── The four ledgers are append-only for EVERY role ──────────────────────────
-- AGENTS.md database rule 6 says stock_movements and audit_log are
-- append-only; bill_events and stock_request_events are the same kind of
-- record. Until now that held only because no role had an UPDATE/DELETE
-- policy — which binds nothing that bypasses RLS: service_role, a definer RPC
-- with a bug, a privileged connection. A trigger binds them all.
--
-- The one escape hatch is a transaction-local setting a direct database
-- session must set on purpose:
--     select set_config('apex.ledger_maintenance', 'on', true);
-- No API path can set it — PostgREST exposes no SET, and no function here
-- calls set_config — so it exists only for the test suites' own cleanup of
-- the rows they create (tests/integration, e2e) and for a deliberate,
-- reviewed maintenance script. It is not a correction mechanism: corrections
-- are compensating rows.

create or replace function public.trg_projects_column_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code
     and exists (select 1 from public.bills b where b.project_id = old.id) then
    raise exception 'FORBIDDEN: a project''s code cannot change once a bill carries it' using errcode = '42501';
  end if;

  if current_user in ('authenticated', 'anon') and (
       new.next_bill_seq          is distinct from old.next_bill_seq
    or new.next_sr_seq            is distinct from old.next_sr_seq
    or new.next_ap_seq            is distinct from old.next_ap_seq
    or new.mobilisation_recovered is distinct from old.mobilisation_recovered
    or new.progress_pct           is distinct from old.progress_pct
    or new.org_id                 is distinct from old.org_id
    or new.created_at             is distinct from old.created_at
    or new.created_by             is distinct from old.created_by
  ) then
    raise exception 'FORBIDDEN: that project field is maintained by the system and cannot be edited directly'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trg_projects_column_guard
  before update on public.projects
  for each row execute function public.trg_projects_column_guard();

create or replace function public.trg_tasks_column_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- end_date is generated from start_date/duration_weeks; it is excluded
  -- because a BEFORE trigger does not see its new value yet.
  v_editable constant text[] := array[
    'name', 'start_date', 'duration_weeks', 'end_date', 'note', 'owner_profile_id',
    'updated_at', 'updated_by'
  ];
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.progress_pct <> 0 or new.deleted_at is not null then
      raise exception 'FORBIDDEN: a new task starts at 0%% — set its progress afterwards' using errcode = '42501';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - v_editable) is distinct from (to_jsonb(old) - v_editable) then
    raise exception 'FORBIDDEN: only a task''s name, dates, duration, note and owner can be edited directly; progress is set with Set progress'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_tasks_column_guard
  before insert or update on public.tasks
  for each row execute function public.trg_tasks_column_guard();

create or replace function public.trg_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('apex.ledger_maintenance', true), '') = 'on' then
    if tg_level = 'STATEMENT' then
      return null;
    elsif tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'FORBIDDEN: % is append-only — record a compensating row instead', tg_table_name
    using errcode = '42501';
end;
$$;

create trigger trg_stock_movements_append_only
  before update or delete on public.stock_movements
  for each row execute function public.trg_append_only();
create trigger trg_stock_movements_no_truncate
  before truncate on public.stock_movements
  for each statement execute function public.trg_append_only();

create trigger trg_audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.trg_append_only();
create trigger trg_audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.trg_append_only();

create trigger trg_bill_events_append_only
  before update or delete on public.bill_events
  for each row execute function public.trg_append_only();
create trigger trg_bill_events_no_truncate
  before truncate on public.bill_events
  for each statement execute function public.trg_append_only();

create trigger trg_stock_request_events_append_only
  before update or delete on public.stock_request_events
  for each row execute function public.trg_append_only();
create trigger trg_stock_request_events_no_truncate
  before truncate on public.stock_request_events
  for each statement execute function public.trg_append_only();
