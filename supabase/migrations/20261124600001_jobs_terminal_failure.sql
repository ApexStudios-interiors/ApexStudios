-- APX-23 — a job that keeps timing out must reach `failed`, and a late
-- finisher must not overwrite another worker's result.
--
-- Three holes, all in 0012 (20260909170012_jobs.sql):
--
--   1. `reap()` (lib/jobs/runner.ts) set EVERY expired `running` row back to
--      `pending`, whatever its attempts. A job that always outlives its
--      5-minute lease was therefore claimed, reaped, claimed again, forever —
--      `rpc_finish_job` never ran for it, so it never went terminal and never
--      reached the Failed Jobs page. It looped silently.
--   2. `rpc_claim_jobs` did not look at attempts at all, so a row an operator
--      or a bug left `pending` past max_attempts was still claimable.
--   3. `rpc_finish_job` updated by id alone. A worker whose lease expired (and
--      whose job was reaped and re-claimed by another worker) could still
--      finish the row afterwards and overwrite the second worker's outcome.
--
-- Fixes, in order: reaping is now an RPC that marks a job `failed` once it has
-- used its attempts (and backs the others off exactly as a failed finish
-- does); claiming requires attempts < max_attempts; finishing requires
-- status = 'running' and, when the caller passes it, the attempt number it
-- claimed. All three stay service_role-only, as 0012's were.

-- ── Claim ────────────────────────────────────────────────────────────────────
-- Same signature as 0012, so `create or replace` keeps the grants.
create or replace function public.rpc_claim_jobs(
  p_names text[],
  p_limit int default 5,
  p_lease interval default '5 minutes'
) returns setof public.jobs
language sql security definer
set search_path = ''
as $$
  update public.jobs j
     set status      = 'running',
         attempts    = j.attempts + 1,
         started_at  = now(),
         lease_until = now() + p_lease
   where j.id in (
     select id from public.jobs
      where status = 'pending'
        and run_after <= now()
        and attempts < max_attempts
        and name = any(p_names)
      order by run_after
      for update skip locked
      limit p_limit
   )
  returning j.*;
$$;

-- ── Finish ───────────────────────────────────────────────────────────────────
-- Return type changes (void -> boolean: "did this finish apply?"), which
-- `create or replace` cannot do, so the old function is dropped first.
-- p_attempt is optional and defaulted, so a runner still calling with the
-- three named arguments 0012 defined (the deployed code during a rollout)
-- resolves to this function unchanged.
drop function if exists public.rpc_finish_job(uuid, boolean, text);

create function public.rpc_finish_job(
  p_id      uuid,
  p_ok      boolean,
  p_error   text default null,
  p_attempt int  default null
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.jobs set
    -- Explicit enum casts are load-bearing — see 0012's comment.
    status = case
               when p_ok then 'succeeded'::public.job_status
               when attempts >= max_attempts then 'failed'::public.job_status
               else 'pending'::public.job_status
             end,
    run_after = case
                  when p_ok then run_after
                  else now() + (power(2, attempts) * interval '1 minute')
                end,
    lease_until = null,
    last_error  = p_error,
    finished_at = case when p_ok or attempts >= max_attempts then now() end
  where id = p_id
    -- Only the worker that holds the row may finish it. A row that is no
    -- longer `running` was reaped (or retried by an admin) while this worker
    -- was still busy; its outcome now belongs to whoever claims it next.
    and status = 'running'
    and (p_attempt is null or attempts = p_attempt);
  return found;
end;
$$;

revoke execute on function public.rpc_finish_job(uuid, boolean, text, int) from public, anon, authenticated;
grant execute on function public.rpc_finish_job(uuid, boolean, text, int) to service_role;

-- ── Reap ─────────────────────────────────────────────────────────────────────
-- Replaces the plain admin-client UPDATE in lib/jobs/runner.ts. An expired
-- lease counts as a failed attempt: the job is backed off like any other
-- failure, and once it has used max_attempts it goes terminal and lands on
-- the Admin ops page with its Retry button. `skip locked`, so a reap that
-- overlaps a finish never blocks on, or fights, the worker still holding the
-- row.
create or replace function public.rpc_reap_jobs()
returns table (requeued int, failed int)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_requeued int;
  v_failed   int;
begin
  with expired as (
    select id
      from public.jobs
     where status = 'running'
       and lease_until < now()
     for update skip locked
  ), reaped as (
    update public.jobs j
       set status = case when j.attempts >= j.max_attempts
                         then 'failed'::public.job_status
                         else 'pending'::public.job_status end,
           run_after = case when j.attempts >= j.max_attempts
                            then j.run_after
                            else now() + (power(2, j.attempts) * interval '1 minute') end,
           lease_until = null,
           last_error  = case when j.attempts >= j.max_attempts
                              then 'lease expired — worker timed out on every attempt'
                              else 'lease expired — worker timed out' end,
           finished_at = case when j.attempts >= j.max_attempts then now() end
      from expired e
     where j.id = e.id
    returning j.status
  )
  select count(*) filter (where r.status = 'pending'),
         count(*) filter (where r.status = 'failed')
    into v_requeued, v_failed
    from reaped r;

  return query select v_requeued, v_failed;
end;
$$;

revoke execute on function public.rpc_reap_jobs() from public, anon, authenticated;
grant execute on function public.rpc_reap_jobs() to service_role;
