-- APX-41 — an archived project is read-only; a completed one takes no new site
-- work.
--
-- No write path checked a project's status, so stock requests, daily updates,
-- approvals and tasks could all still be created on an archived project. The
-- check now lives in the database, as one BEFORE INSERT OR UPDATE trigger on
-- every project-scoped table people write to, so it holds for the web app,
-- the mobile API and every security definer RPC alike (each of those writes
-- through these tables, and a trigger fires for all of them):
--
--   archived   every insert and update is refused   → PROJECT_ARCHIVED
--   completed  a NEW stock request or daily update  → PROJECT_COMPLETED
--              is refused; everything else (billing, payments, delivering
--              what was already ordered, a client deciding an approval,
--              correcting a task) still works
--
-- Billing and payments must keep working on a finished project — retention
-- and late payments arrive long after the work — so the trigger is told,
-- per table, which columns an update may change and still be allowed:
--
--   phases    billing_status   rpc_create_bill / rpc_record_payment move a
--                              phase to Billed / Paid
--   packages  progress_pct     the trigger-maintained rollup cache
--
-- (updated_at / updated_by are always ignored: trg_set_updated_at bumps them.)
-- attachments with entity_type 'bill' are never refused, so a bill PDF or an
-- uploaded bill copy still attaches. bills and payments are not guarded at
-- all.
--
-- lib/safe-action.ts maps both codes to user copy; the app also disables the
-- buttons for these states (features/projects/service.ts
-- projectWriteRefusal), but this is the boundary, not the buttons.
--
-- Named trg_00_… so it fires FIRST among each table's BEFORE triggers
-- (Postgres fires them in name order): a write to a read-only project is
-- refused for that reason, before an ancestry check can report something
-- less useful.

create or replace function public.fn_project_write_refusal(
  p_project_id uuid,
  p_table      text,
  p_op         text
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status public.project_status;
begin
  if p_project_id is null then
    return null;
  end if;
  -- Security definer so the read is not narrowed by projects_select: a caller
  -- who could not see the project is refused by the table's own RLS anyway,
  -- and this only needs the status.
  select status into v_status from public.projects where id = p_project_id;
  if v_status = 'archived' then
    return 'PROJECT_ARCHIVED';
  end if;
  if v_status = 'completed' and p_op = 'INSERT' and p_table in ('stock_requests', 'daily_updates') then
    return 'PROJECT_COMPLETED';
  end if;
  return null;
end;
$$;

-- Not callable by anyone directly: it reads any project's status past RLS.
-- The trigger below runs it as the definer.
revoke execute on function public.fn_project_write_refusal(uuid, text, text) from public, anon, authenticated;

-- TG_ARGV: the columns an UPDATE may change on a read-only project and still
-- go through (see the header). Compared as jsonb with those keys removed.
create or replace function public.trg_project_writable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refusal text;
  v_ignored text[] := array['updated_at', 'updated_by'];
begin
  if tg_nargs > 0 then
    v_ignored := v_ignored || tg_argv;
  end if;
  -- Read through jsonb: `new.entity_type` would not even parse for the tables
  -- that have no such column.
  if tg_table_name = 'attachments' and (to_jsonb(new) ->> 'entity_type') = 'bill' then
    return new;
  end if;

  v_refusal := public.fn_project_write_refusal(new.project_id, tg_table_name, tg_op);
  if v_refusal is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and (to_jsonb(new) - v_ignored) = (to_jsonb(old) - v_ignored) then
    return new;
  end if;

  if v_refusal = 'PROJECT_ARCHIVED' then
    raise exception 'PROJECT_ARCHIVED: project % is archived and read-only (% on %)',
      new.project_id, lower(tg_op), tg_table_name
      using errcode = '42501';
  end if;
  raise exception 'PROJECT_COMPLETED: project % is completed; no new % can be added',
    new.project_id, replace(tg_table_name, '_', ' ')
    using errcode = '42501';
end;
$$;

create trigger trg_00_project_writable before insert or update on public.stock_requests
  for each row execute function public.trg_project_writable();
create trigger trg_00_project_writable before insert or update on public.approvals
  for each row execute function public.trg_project_writable();
create trigger trg_00_project_writable before insert or update on public.daily_updates
  for each row execute function public.trg_project_writable();
create trigger trg_00_project_writable before insert or update on public.tasks
  for each row execute function public.trg_project_writable();
create trigger trg_00_project_writable before insert or update on public.phases
  for each row execute function public.trg_project_writable('billing_status');
create trigger trg_00_project_writable before insert or update on public.packages
  for each row execute function public.trg_project_writable('progress_pct');
create trigger trg_00_project_writable before insert or update on public.attachments
  for each row execute function public.trg_project_writable();

-- ── A billed phase's allocated amount is fixed (APX-10) ──────────────────────
-- Billable Now and every bill line value a phase at its allocated amount. Once
-- a phase is on a bill (billed, and later paid), changing that amount would
-- make the bill disagree with the phase it billed; a correction is a credit
-- note or an adjustment on the next bill, as for the bill itself. updatePhase
-- checks this first for a friendly message; this is the boundary.
create or replace function public.trg_phases_allocated_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.billing_status in ('billed', 'paid')
     and new.allocated_amount is distinct from old.allocated_amount then
    raise exception 'PHASE_BILLED: phase % is already on a bill; its allocated amount cannot change', old.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_phases_allocated_locked before update of allocated_amount on public.phases
  for each row execute function public.trg_phases_allocated_locked();
