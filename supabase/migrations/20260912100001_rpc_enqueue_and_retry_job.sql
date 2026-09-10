-- 0024 — rpc_enqueue_job, rpc_retry_job
--
-- build/06-files-jobs-daily-updates.md §3.1, §3.7. `jobs` (migration 0012)
-- shipped with rpc_claim_jobs/rpc_finish_job, both service_role-only — the
-- job RUNNER's own primitives. This migration adds the two RPCs ordinary
-- application code needs: enqueueing work from inside a normal user session
-- (confirmUpload enqueues attachment.thumbnail), and an admin retrying a
-- failed row from the ops page. `jobs` itself still has no insert/update
-- policy for any role — both go through security definer, same as before.

-- ── Enqueue ──────────────────────────────────────────────────────────────────
-- Callable by any authenticated user, but only for job names a real user
-- SESSION actually enqueues from a request path — this build, that is exactly
-- one: confirmUpload enqueues attachment.thumbnail. The scheduled jobs
-- (jobs.reap, inventory.reconcile, weekly.maintenance's tasks, backup.verify)
-- are self-enqueued by their own cron route instead, straight through the
-- service_role client `lib/jobs/runner.ts` already uses for claim/finish —
-- a cron invocation authenticates via CRON_SECRET, not a Supabase session, so
-- it has no auth.uid()/auth_org() for this function to read in the first
-- place. Extend this array only when a later build adds a new job a signed-in
-- user's own action enqueues (Build 09's bill.pdf, for one).
create or replace function public.rpc_enqueue_job(
  p_name            text,
  p_payload         jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_run_after       timestamptz default now()
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_name <> all (array[
    'attachment.thumbnail'
  ]) then
    raise exception 'FORBIDDEN: % is not an enqueueable job name', p_name;
  end if;

  insert into public.jobs (org_id, name, payload, idempotency_key, run_after)
  values (public.auth_org(), p_name, p_payload, p_idempotency_key, p_run_after)
  on conflict (name, idempotency_key) do nothing
  returning id into v_id;

  -- T-24: enqueuing the same (name, idempotency_key) twice creates one row.
  -- The insert above no-ops on the second call (jobs_idem_uq), so v_id comes
  -- back null; look the existing row up instead of returning nothing.
  if v_id is null then
    select id into v_id
      from public.jobs
     where name = p_name
       and idempotency_key is not distinct from p_idempotency_key
     order by created_at desc
     limit 1;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.rpc_enqueue_job(text, jsonb, text, timestamptz) from public, anon;
grant execute on function public.rpc_enqueue_job(text, jsonb, text, timestamptz) to authenticated, service_role;

-- ── Retry ────────────────────────────────────────────────────────────────────
-- Admin ops page (build §3.7). Resets attempts to 0, not just status: a job
-- already at max_attempts would otherwise fail again after exactly one more
-- try, since rpc_finish_job's backoff decision reads the CURRENT attempts
-- value — a "retry" that can't actually retry isn't one.
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
         last_error  = null,
         finished_at = null
   where id = p_id
     and status = 'failed';

  if not found then
    raise exception 'NOT_FOUND: job % is not in a failed state', p_id;
  end if;
end;
$$;

revoke execute on function public.rpc_retry_job(uuid) from public, anon;
grant execute on function public.rpc_retry_job(uuid) to authenticated;
