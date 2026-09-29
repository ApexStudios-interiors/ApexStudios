-- 0042 — rpc_retry_job keeps last_error, so a retry is visible
--
-- Retrying a failed job set status back to 'pending' AND cleared last_error,
-- attempts and finished_at. The Failed Jobs page lists status = 'failed', so
-- the row vanished the instant Retry was pressed — and because every trace of
-- the failure was wiped in the same statement, a retried job was
-- indistinguishable from one that had never run. There was nothing left to
-- report progress from.
--
-- `last_error` is now kept. It is the error from the PREVIOUS failure, which
-- is exactly the marker the page needs: a job that is pending or running and
-- still carries an error is one that failed before and is being retried now.
-- The runner overwrites it on the next failure and it is ignored once the job
-- succeeds, so nothing downstream reads a stale value as current.
--
-- attempts, run_after, lease_until and finished_at still reset: the runner
-- needs attempts below max_attempts to pick the job up at all, so resetting
-- them is what makes a retry a retry.
create or replace function public.rpc_retry_job(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: rpc_retry_job is admin-only';
  end if;
  update public.jobs
     set status      = 'pending',
         attempts    = 0,
         run_after   = now(),
         lease_until = null,
         finished_at = null
   where id = p_id
     and status = 'failed';
  if not found then
    raise exception 'NOT_FOUND: job % is not in a failed state', p_id;
  end if;
end;
$$;
