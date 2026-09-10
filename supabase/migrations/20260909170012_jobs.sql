-- 0012 — background job queue
--
-- 02-lld.md §3.10. The table, the claim function and the completion function
-- land now so Build 06 starts with the concurrency primitive already tested.
-- The runner, the cron routes and the handlers are Build 06's.

create table public.jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references public.orgs(id),
  name            text not null,                    -- 'backup.nightly','attachment.thumbnail'
  status          public.job_status not null default 'pending',
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text,
  attempts        int not null default 0,
  max_attempts    int not null default 5,
  run_after       timestamptz not null default now(),
  lease_until     timestamptz,                      -- expiry means the worker died
  last_error      text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  -- Enqueuing a thumbnail twice for the same attachment is a no-op rather than a
  -- duplicate render. `nulls not distinct` so two un-keyed jobs of the same name
  -- still collide rather than piling up.
  constraint jobs_idem_uq unique nulls not distinct (name, idempotency_key)
);

-- Three partial indexes covering exactly the three queries the runner makes,
-- and indexing nothing else.
create index idx_jobs_claimable on public.jobs (run_after) where status = 'pending';
create index idx_jobs_expired on public.jobs (lease_until) where status = 'running';
create index idx_jobs_failed on public.jobs (name, finished_at desc) where status = 'failed';
create index idx_jobs_org on public.jobs (org_id);

alter table public.jobs enable row level security;
alter table public.jobs force row level security;

-- The Admin ops page lists failures. Nothing else reads this table.
create policy jobs_select_admin on public.jobs for select to authenticated
  using ( public.is_admin() and (org_id is null or org_id = public.auth_org()) );

-- No insert, update or delete policy for any role. Enqueue and claim are both
-- security definer: a user cannot schedule work.

-- ── Claim ────────────────────────────────────────────────────────────────────
-- The entire concurrency story is the one `for update skip locked` clause: two
-- overlapping cron invocations do not block each other and do not double-run a
-- job, because the second simply skips the rows the first has locked.
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
        and name = any(p_names)
      order by run_after
      for update skip locked
      limit p_limit
   )
  returning j.*;
$$;

-- ── Completion ───────────────────────────────────────────────────────────────
-- Exponential backoff: 1m, 2m, 4m, 8m, 16m, then terminal 'failed', surfaced on
-- the Admin ops page with a Retry button (architecture.md §8.3).
create or replace function public.rpc_finish_job(
  p_id uuid,
  p_ok boolean,
  p_error text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.jobs set
    -- Explicit casts are load-bearing, not stylistic. A CASE over untyped
    -- string literals resolves its own result type to `text` first, and only
    -- then gets assigned to `status` — but Postgres has no implicit cast from
    -- text to a user-defined enum, so an uncast CASE here fails at call time
    -- ("column status is of type job_status but expression is of type text"),
    -- even though `create or replace function` accepts the body without
    -- complaint: plpgsql does not fully type-check a function body until it
    -- actually runs.
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
  where id = p_id;
end;
$$;

-- Both are definer functions reachable from the app, so lock them down to the
-- service_role the job runner uses. A signed-in user must not be able to claim
-- or finish work.
revoke execute on function public.rpc_claim_jobs(text[], int, interval) from public, anon, authenticated;
revoke execute on function public.rpc_finish_job(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.rpc_claim_jobs(text[], int, interval) to service_role;
grant execute on function public.rpc_finish_job(uuid, boolean, text) to service_role;
