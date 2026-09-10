-- 0023 — rpc_set_task_progress, rpc_mark_phase_complete
--
-- build/05-schedule-and-progress.md §3.1.

create or replace function public.rpc_set_task_progress(p_task_id uuid, p_pct smallint)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_task       public.tasks%rowtype;
  v_before     jsonb;
  v_task_count int;
  v_done_count int;
  v_new_status public.phase_billing_status;
begin
  select * into v_task from public.tasks where id = p_task_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND: task % does not exist', p_task_id;
  end if;

  if not public.is_member_of(v_task.project_id) or public.auth_role() not in ('owner', 'admin', 'site') then
    raise exception 'FORBIDDEN: rpc_set_task_progress requires project membership and owner/admin/site';
  end if;

  -- The check constraint would also catch this, but a clean domain error here
  -- beats a raw constraint-violation message reaching the client (safe-action's
  -- mapDomainError only recognises the prefixed form).
  if p_pct < 0 or p_pct > 100 then
    raise exception 'REASON_REQUIRED: progress must be between 0 and 100';
  end if;

  v_before := to_jsonb(v_task);

  -- updated_at: trg_tasks_updated_at (0005) sets it unconditionally; setting
  -- it here too would just be a second writer agreeing with the first.
  update public.tasks
     set progress_pct = p_pct, updated_by = auth.uid()
   where id = p_task_id;
  -- trg_tasks_after_update (0016) recomputes packages/projects.progress_pct
  -- from this same write. Nothing here duplicates that cache.

  select count(*), count(*) filter (where progress_pct = 100)
    into v_task_count, v_done_count
    from public.tasks
   where phase_id = v_task.phase_id and deleted_at is null;

  v_new_status := case
    when v_task_count > 0 and v_task_count = v_done_count then 'billable'::public.phase_billing_status
    else 'unresolved'::public.phase_billing_status
  end;

  -- A status with commercial meaning is flipped only when it is still in an
  -- unresolved/billable state — never for a phase already billed or paid.
  -- That is the difference between a progress correction and a silent
  -- restatement of an issued invoice.
  update public.phases
     set billing_status = v_new_status
   where id = v_task.phase_id
     and billing_status in ('unresolved', 'billable')
     and billing_status is distinct from v_new_status;

  perform public.fn_audit(
    'task', p_task_id, 'update', v_before,
    to_jsonb((select t from public.tasks t where t.id = p_task_id))
  );
end;
$$;

revoke execute on function public.rpc_set_task_progress(uuid, smallint) from public, anon;
grant execute on function public.rpc_set_task_progress(uuid, smallint) to authenticated;

-- ── rpc_mark_phase_complete ──────────────────────────────────────────────────
-- 02-lld.md §5.7. The "Mark Complete" button in the package Billing tab
-- (ui-guide.md §6.5) — a human asserting billability where no schedule
-- exists, so it needs a name against it. Admin only, and only permitted when
-- the phase has zero tasks: a phase WITH tasks is driven entirely by
-- rpc_set_task_progress above, and letting this RPC also apply to it would be
-- a second, conflicting way to reach the same status.
--
-- Its Server Action and UI wiring land in Build 09 with the rest of the
-- Billing tab conversion — this migration ships the RPC and its tests now,
-- per this build's own deliverables list, not the application layer around it.
create or replace function public.rpc_mark_phase_complete(p_phase_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_phase      public.phases%rowtype;
  v_before     jsonb;
  v_task_count int;
begin
  select * into v_phase from public.phases where id = p_phase_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND: phase % does not exist', p_phase_id;
  end if;

  if not public.is_admin() then
    raise exception 'FORBIDDEN: rpc_mark_phase_complete is admin-only';
  end if;

  select count(*) into v_task_count from public.tasks where phase_id = p_phase_id and deleted_at is null;
  if v_task_count > 0 then
    raise exception 'ILLEGAL_TRANSITION: rpc_mark_phase_complete only applies to a phase with no tasks';
  end if;

  if v_phase.billing_status not in ('unresolved', 'billable') then
    raise exception 'ILLEGAL_TRANSITION: phase % is already % — manual completion cannot reopen it',
      p_phase_id, v_phase.billing_status;
  end if;

  v_before := to_jsonb(v_phase);

  update public.phases
     set billing_status = 'billable',
         manual_complete_at = now(),
         manual_complete_by = auth.uid()
   where id = p_phase_id;

  perform public.fn_audit(
    'phase', p_phase_id, 'update', v_before,
    to_jsonb((select p from public.phases p where p.id = p_phase_id))
  );
end;
$$;

revoke execute on function public.rpc_mark_phase_complete(uuid) from public, anon;
grant execute on function public.rpc_mark_phase_complete(uuid) to authenticated;
