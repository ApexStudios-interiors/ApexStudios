-- Security hardening (audit 2026-11-24, APX-35): rpc_enqueue_job checks WHAT
-- is being queued, not only its name
--
-- rpc_enqueue_job is granted to authenticated with nothing but a name
-- allow-list (attachment.thumbnail, bill.pdf). Any signed-in user — a client
-- included — could queue bill.pdf for any bill id, and the handler did not
-- check status, so a DRAFT bill was rendered into a readable invoice
-- attachment; or queue thousands of jobs under fresh idempotency keys.
--
-- The audit's suggested fix is to revoke the RPC and enqueue from definer
-- RPCs. That is the right end state, but it cannot be deployed safely here:
-- the app enqueues (features/attachments/upload.ts, features/billing/
-- transition.ts) and Vercel deploys on merge while `pnpm db:push` runs
-- separately, so one side would be missing its half for that window. Instead
-- the RPC now re-derives the job from the database for a signed-in caller,
-- which closes the same holes and works with both the previous and the new
-- app build:
--
--   attachment.thumbnail  the attachment must exist, be live, be in the
--                         caller's org and have been uploaded BY the caller.
--   bill.pdf              admin only; the bill must exist in the caller's org,
--                         be live and be 'submitted'.
--
-- In both cases the payload is rebuilt from the row ({attachmentId} /
-- {billId}), the idempotency key is the one the app already uses (the
-- attachment id; billPdfJobKey = '<billId>:submitted:r<revision>' from the
-- bill's CURRENT revision), and run_after is now(). A caller can therefore
-- neither aim a job at a record that is not theirs nor mint new keys to flood
-- the queue: a repeat returns the existing job.
--
-- A caller with no auth.uid() (service_role) is unchanged. The handler side
-- (lib/jobs/handlers/bill.pdf.ts) separately refuses a bill that is not, or is
-- no longer, issued — a job claimed after a rejection renders nothing.
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
  v_id        uuid;
  v_payload   jsonb := p_payload;
  v_key       text := p_idempotency_key;
  v_run_after timestamptz := p_run_after;
  v_target    uuid;
  v_status    public.bill_status;
  v_revision  int;
begin
  if p_name <> all (array[
    'attachment.thumbnail',
    'bill.pdf'
  ]) then
    raise exception 'FORBIDDEN: % is not an enqueueable job name', p_name;
  end if;

  if auth.uid() is not null then
    begin
      v_target := (p_payload ->> case p_name when 'bill.pdf' then 'billId' else 'attachmentId' end)::uuid;
    exception when invalid_text_representation then
      v_target := null;
    end;
    if v_target is null then
      raise exception 'REASON_REQUIRED: % needs the id of the record it is for', p_name using errcode = '23514';
    end if;

    if p_name = 'attachment.thumbnail' then
      if not exists (
        select 1 from public.attachments a
         where a.id = v_target
           and a.uploaded_by = auth.uid()
           and a.org_id = public.auth_org()
           and a.deleted_at is null
      ) then
        raise exception 'FORBIDDEN: that attachment is not yours to process' using errcode = '42501';
      end if;
      v_payload := jsonb_build_object('attachmentId', v_target);
      v_key := v_target::text;

    else
      if not coalesce(public.is_admin(), false) then
        raise exception 'FORBIDDEN: only an admin may queue an invoice render' using errcode = '42501';
      end if;
      select b.status, b.revision into v_status, v_revision
        from public.bills b
       where b.id = v_target and b.org_id = public.auth_org() and b.deleted_at is null;
      if not found then
        raise exception 'NOT_FOUND: bill % does not exist', v_target using errcode = 'P0002';
      end if;
      if v_status <> 'submitted' then
        raise exception 'ILLEGAL_TRANSITION: only a submitted bill has an invoice to render' using errcode = '23514';
      end if;
      v_payload := jsonb_build_object('billId', v_target);
      v_key := v_target::text || ':submitted:r' || v_revision::text;
    end if;

    v_run_after := now();
  end if;

  insert into public.jobs (org_id, name, payload, idempotency_key, run_after)
  values (public.auth_org(), p_name, v_payload, v_key, v_run_after)
  on conflict (name, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
      from public.jobs
     where name = p_name
       and idempotency_key is not distinct from v_key
     order by created_at desc
     limit 1;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.rpc_enqueue_job(text, jsonb, text, timestamptz) from public, anon;
grant execute on function public.rpc_enqueue_job(text, jsonb, text, timestamptz) to authenticated, service_role;
