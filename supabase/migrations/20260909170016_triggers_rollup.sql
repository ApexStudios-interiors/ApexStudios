-- 0016 — progress rollup trigger
--
-- 01-hld.md §5.3. packages.progress_pct is the duration-weighted mean of its
-- tasks; projects.progress_pct is the allocated-weighted mean of its packages.
--
-- Cached rather than computed because the portfolio page renders every project's
-- packages, and a weighted mean over every task on every portfolio load does not
-- survive twenty projects. This is the exception AGENTS.md carves out from
-- "do not store derived values": trigger-maintained rollups.
--
-- Flipping phases.billing_status to 'billable' when every task reaches 100% is
-- deliberately NOT here. A status with commercial meaning is set by an audited,
-- explicit call — rpc_set_task_progress in Build 05.

create or replace function public.fn_recompute_progress(p_package_id uuid, p_project_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_pkg_progress smallint;
begin
  -- Duration-weighted mean over live tasks. A 3-week task at 100% and a 1-week
  -- task at 0% give 75%, not 50%.
  select coalesce(
           case when sum(t.duration_weeks) > 0
                then round(sum(t.duration_weeks * t.progress_pct)::numeric
                           / sum(t.duration_weeks), 0)
                else 0 end, 0)::smallint
    into v_pkg_progress
    from public.tasks t
   where t.package_id = p_package_id
     and t.deleted_at is null;

  -- Only write when the value actually changes. This keeps the statement
  -- idempotent, avoids waking the updated_at trigger on every task edit, and
  -- means a re-run of the same trigger is a no-op rather than a second update.
  update public.packages
     set progress_pct = v_pkg_progress
   where id = p_package_id
     and progress_pct is distinct from v_pkg_progress;

  -- Allocated-weighted mean over live packages. A package with no allocation
  -- carries no weight, which is why an all-zero project stays at 0 rather than
  -- dividing by zero.
  update public.projects pr
     set progress_pct = coalesce(agg.progress, 0)
    from (
      select case when sum(pk.allocated_amount) > 0
                  then round(sum(pk.allocated_amount * pk.progress_pct)
                             / sum(pk.allocated_amount), 0)
                  else 0 end as progress
        from public.packages pk
       where pk.project_id = p_project_id
         and pk.deleted_at is null
    ) agg
   where pr.id = p_project_id
     and pr.progress_pct is distinct from coalesce(agg.progress, 0)::smallint;
end;
$$;

create or replace function public.trg_tasks_after_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- A soft delete arrives as an UPDATE setting deleted_at, and the aggregate
  -- above filters deleted_at is null, so the row correctly drops out of the
  -- mean. A move between packages has to recompute both sides.
  if tg_op = 'DELETE' then
    perform public.fn_recompute_progress(old.package_id, old.project_id);
  else
    perform public.fn_recompute_progress(new.package_id, new.project_id);
    if tg_op = 'UPDATE' and old.package_id is distinct from new.package_id then
      perform public.fn_recompute_progress(old.package_id, old.project_id);
    end if;
  end if;
  return null;  -- AFTER trigger; the return value is ignored
end;
$$;

-- Statement-level would be cheaper but cannot see which packages changed.
-- Row-level with a no-op guard inside fn_recompute_progress is the trade taken.
--
-- Re-entrancy: this trigger updates packages, which has its own updated_at
-- trigger, but that one is BEFORE UPDATE on packages and does not touch tasks.
-- There is no path back into this trigger, so no recursion.
create trigger trg_tasks_after_update
  after insert or update or delete on public.tasks
  for each row execute function public.trg_tasks_after_update();
