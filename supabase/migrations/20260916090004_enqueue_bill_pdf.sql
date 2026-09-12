-- 0043 — rpc_enqueue_job: allow 'bill.pdf'
--
-- 0024's own comment: "Extend this array only when a later build adds a new
-- job a signed-in user's own action enqueues (Build 09's bill.pdf, for
-- one)." transitionBill enqueues it right after draft -> submitted succeeds
-- (build/09-billing.md §4.6, application layer — same place confirmUpload
-- enqueues attachment.thumbnail).
--
-- Never edit an already-applied migration (AGENTS.md database rule 1) — the
-- whole function is recreated here, not altered in place in 0024.
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
    'attachment.thumbnail',
    'bill.pdf'
  ]) then
    raise exception 'FORBIDDEN: % is not an enqueueable job name', p_name;
  end if;

  insert into public.jobs (org_id, name, payload, idempotency_key, run_after)
  values (public.auth_org(), p_name, p_payload, p_idempotency_key, p_run_after)
  on conflict (name, idempotency_key) do nothing
  returning id into v_id;

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
