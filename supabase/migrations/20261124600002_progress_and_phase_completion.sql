-- APX-21, APX-43, APX-26 — project progress that follows its packages, a
-- manual phase completion that yields to real tasks, and a v_phase_billing
-- that no longer aggregates the whole org on every read.
--
-- ── APX-21 ───────────────────────────────────────────────────────────────────
-- projects.progress_pct is the allocation-weighted mean of its packages, but
-- 0016 only recomputed it from the TASK trigger. Adding a package, changing a
-- package's allocated_amount or soft-deleting one left the project figure —
-- the one clients see on their portfolio — stale until someone happened to
-- edit a task. And a project whose packages all carry a 0 allocation read 0%
-- however much work was done, because a zero-weight mean is defined as 0.
--
-- Now: the project half of the rollup is its own function, called both by the
-- task path (unchanged shape) and by a new packages trigger on insert, delete
-- and update of allocated_amount / deleted_at / project_id. When the live
-- allocations sum to 0 it falls back to the plain mean of package progress.
--
-- ── APX-43 ───────────────────────────────────────────────────────────────────
-- "Mark Complete" (rpc_mark_phase_complete) is for a phase with no tasks. If
-- tasks were added afterwards at 0%, the phase stayed complete — and billable
-- at 100% in Billable Now — because is_complete was
-- `all tasks done OR manual_complete_at is not null`. A manual completion now
-- counts ONLY while the phase has no live tasks: once tasks exist, they alone
-- decide. manual_complete_at/_by are kept (they are the record of who marked
-- it), simply no longer consulted while tasks exist.
--
-- billing_status used to be flipped between unresolved and billable only by
-- rpc_set_task_progress. A task added, deleted, moved or edited any other way
-- (createTask/updateTask, a soft delete) left it wrong. The task trigger now
-- maintains it for every affected phase, with the same rule as is_complete,
-- and still never touches a phase that is already billed or paid.
--
-- ── APX-26 ───────────────────────────────────────────────────────────────────
-- v_phase_billing grouped phases LEFT JOIN tasks by ph.id. A filter on
-- project_id or package_id (what every caller passes) cannot be pushed below
-- that GROUP BY, so each read aggregated every phase in the org. A lateral
-- per-phase aggregate lets the filter reach `phases` directly and each phase
-- use idx_tasks_phase. Same columns, same types, same order — so
-- `create or replace` keeps v_billable_now, which depends on it, intact.

-- ── Project rollup ───────────────────────────────────────────────────────────
create or replace function public.fn_recompute_project_progress(p_project_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_progress smallint;
begin
  if p_project_id is null then
    return;
  end if;

  select coalesce(
           case when sum(pk.allocated_amount) > 0
                then round(sum(pk.allocated_amount * pk.progress_pct)
                           / sum(pk.allocated_amount), 0)
                -- No allocation anywhere (all zero, e.g. a project still being
                -- priced): every package counts equally rather than the
                -- project reading 0% regardless of the work done.
                else round(avg(pk.progress_pct), 0)
           end, 0)::smallint
    into v_progress
    from public.packages pk
   where pk.project_id = p_project_id
     and pk.deleted_at is null;

  update public.projects
     set progress_pct = v_progress
   where id = p_project_id
     and progress_pct is distinct from v_progress;
end;
$$;

-- Same signature as 0016, so the task trigger that calls it is untouched.
create or replace function public.fn_recompute_progress(p_package_id uuid, p_project_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_pkg_progress smallint;
begin
  -- Duration-weighted mean over live tasks (0016, unchanged).
  select coalesce(
           case when sum(t.duration_weeks) > 0
                then round(sum(t.duration_weeks * t.progress_pct)::numeric
                           / sum(t.duration_weeks), 0)
                else 0 end, 0)::smallint
    into v_pkg_progress
    from public.tasks t
   where t.package_id = p_package_id
     and t.deleted_at is null;

  -- progress_pct only: the packages trigger below watches allocated_amount,
  -- deleted_at and project_id, so this write does not re-enter it.
  update public.packages
     set progress_pct = v_pkg_progress
   where id = p_package_id
     and progress_pct is distinct from v_pkg_progress;

  perform public.fn_recompute_project_progress(p_project_id);
end;
$$;

-- ── Phase completion, maintained from the task trigger ───────────────────────
-- One rule, used here and (below) in all three phase views:
--   live tasks exist  -> complete iff every one is at 100%
--   no live tasks     -> complete iff marked complete by hand
create or replace function public.fn_refresh_phase_billing(p_phase_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count  int;
  v_done   int;
  v_manual boolean;
  v_status public.phase_billing_status;
begin
  if p_phase_id is null then
    return;
  end if;

  select count(*), count(*) filter (where t.progress_pct = 100)
    into v_count, v_done
    from public.tasks t
   where t.phase_id = p_phase_id
     and t.deleted_at is null;

  select ph.manual_complete_at is not null into v_manual
    from public.phases ph
   where ph.id = p_phase_id;
  if not found then
    return;  -- phase hard-deleted in the same statement (cascade)
  end if;

  v_status := case
    when (v_count > 0 and v_count = v_done) or (v_count = 0 and v_manual)
      then 'billable'::public.phase_billing_status
    else 'unresolved'::public.phase_billing_status
  end;

  -- Never for a phase already billed or paid: that would silently restate an
  -- issued invoice (rpc_set_task_progress's own rule, 0023).
  update public.phases
     set billing_status = v_status
   where id = p_phase_id
     and billing_status in ('unresolved', 'billable')
     and billing_status is distinct from v_status;
end;
$$;

create or replace function public.trg_tasks_after_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.fn_recompute_progress(old.package_id, old.project_id);
    perform public.fn_refresh_phase_billing(old.phase_id);
  else
    perform public.fn_recompute_progress(new.package_id, new.project_id);
    perform public.fn_refresh_phase_billing(new.phase_id);
    if tg_op = 'UPDATE' and old.package_id is distinct from new.package_id then
      perform public.fn_recompute_progress(old.package_id, old.project_id);
    end if;
    if tg_op = 'UPDATE' and old.phase_id is distinct from new.phase_id then
      perform public.fn_refresh_phase_billing(old.phase_id);
    end if;
  end if;
  return null;
end;
$$;
-- trg_tasks_after_update (0016) already points at this function by name.

-- ── Packages trigger: the project rollup follows package changes ─────────────
create or replace function public.trg_packages_after_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.fn_recompute_project_progress(old.project_id);
  else
    perform public.fn_recompute_project_progress(new.project_id);
    if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
      perform public.fn_recompute_project_progress(old.project_id);
    end if;
  end if;
  return null;
end;
$$;

-- Column-scoped on UPDATE: fn_recompute_progress writes packages.progress_pct,
-- which is deliberately not in this list, so there is no recursion and no
-- second project recompute per task edit.
create trigger trg_packages_after_change
  after insert or delete or update of allocated_amount, deleted_at, project_id
  on public.packages
  for each row execute function public.trg_packages_after_change();

-- ── Views ────────────────────────────────────────────────────────────────────
create or replace view public.v_phase_billing
with (security_invoker = on) as
select
  ph.id as phase_id,
  ph.project_id,
  ph.package_id,
  ph.name,
  ph.allocated_amount,
  ph.internal_amount,
  ph.billing_status,
  t.task_count,
  t.tasks_done,
  case when t.task_count > 0 then t.task_count = t.tasks_done
       else ph.manual_complete_at is not null end as is_complete
from public.phases ph
cross join lateral (
  select count(*) as task_count,
         count(*) filter (where tk.progress_pct = 100) as tasks_done
    from public.tasks tk
   where tk.phase_id = ph.id
     and tk.deleted_at is null
) t
where ph.deleted_at is null;

comment on view public.v_phase_billing is
  'Admin-only. Carries internal_amount. is_complete is derived, never stored: with live tasks, all at 100%; with none, a manual completion (APX-43).';

create or replace view public.v_phase_client
with (security_invoker = off) as
select
  ph.id,
  ph.project_id,
  ph.package_id,
  ph.seq_no,
  ph.name,
  ph.allocated_amount as contract_value,
  ph.billing_status,
  case when t.task_count > 0 then t.task_count = t.tasks_done
       else ph.manual_complete_at is not null end as is_complete
from public.phases ph
left join lateral (
  select count(*) as task_count, count(*) filter (where tk.progress_pct = 100) as tasks_done
  from public.tasks tk
  where tk.phase_id = ph.id and tk.deleted_at is null
) t on true
where ph.deleted_at is null and public.is_member_of(ph.project_id);

comment on view public.v_phase_client is
  'Client-facing. OMITS internal_amount. billing_status is shown because the client needs to know what has been billed; the cost behind it is not. is_complete is computed inline against tasks directly (not via v_phase_billing) so this definer view does not depend on an invoker-mode view''s RLS evaluation; same rule as v_phase_billing (APX-43).';

create or replace view public.v_phase_site
with (security_invoker = off) as
select
  ph.id, ph.project_id, ph.package_id, ph.seq_no, ph.name, ph.billing_status,
  case when t.task_count > 0 then t.task_count = t.tasks_done
       else ph.manual_complete_at is not null end as is_complete
from public.phases ph
left join lateral (
  select count(*) as task_count, count(*) filter (where tk.progress_pct = 100) as tasks_done
  from public.tasks tk
  where tk.phase_id = ph.id and tk.deleted_at is null
) t on true
where ph.deleted_at is null and public.is_member_of(ph.project_id);

comment on view public.v_phase_site is
  'Site-facing. OMITS allocated_amount and internal_amount — no money at all, matching v_package_site (01-hld.md §3). is_complete is computed inline against tasks directly; same rule as v_phase_billing (APX-43).';

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Bring every live project and phase onto the new rules once, so nothing
-- waits for its next edit. Both functions only write when the value changes.
do $$
declare r record;
begin
  for r in select id from public.projects where deleted_at is null loop
    perform public.fn_recompute_project_progress(r.id);
  end loop;
  for r in select id from public.phases
            where deleted_at is null and billing_status in ('unresolved', 'billable') loop
    perform public.fn_refresh_phase_billing(r.id);
  end loop;
end;
$$;
