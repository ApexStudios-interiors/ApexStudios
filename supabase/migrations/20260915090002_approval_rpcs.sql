-- 0035 — rpc_create_approval, rpc_decide_approval
--
-- build/08-approvals.md §2.1. 02-lld.md §5.4/§8.2 is the source for
-- rpc_decide_approval's shape: lock the row, check the role, check
-- membership, check the row is still pending, then validate the decision
-- itself — in that exact order, matching the build file's own numbered list
-- (the same reason rpc_transition_stock_request's own order matters).

-- ── Create ───────────────────────────────────────────────────────────────────
-- `p_id` is client-generated (`crypto.randomUUID()`, `NewApprovalDialog`),
-- not server-assigned — the same reason `daily_updates`' own insert takes an
-- explicit id (features/updates/schema.ts's own comment): `FileUploader`'s
-- sample photos upload and confirm BEFORE this row exists, so the id has to
-- be chosen first and carried through both the uploads and this insert.
create or replace function public.rpc_create_approval(
  p_id            uuid,
  p_project_id    uuid,
  p_package_id    uuid,
  p_type          public.approval_type,
  p_item          text,
  p_phase_id      uuid default null,
  p_note          text default null,
  p_needed_by     date default null,
  p_supersedes_id uuid default null
) returns public.approvals
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role       public.app_role;
  v_seq        int;
  v_code       text;
  v_ref        text;
  v_row        public.approvals;
  v_superseded public.approvals;
begin
  v_role := public.auth_role();

  if not public.is_member_of(p_project_id) then
    raise exception 'FORBIDDEN: not a member of project %', p_project_id using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin', 'site') then
    raise exception 'FORBIDDEN: requires owner, admin or site' using errcode = '42501';
  end if;
  if btrim(coalesce(p_item, '')) = '' then
    raise exception 'REASON_REQUIRED: item is required' using errcode = '23514';
  end if;

  -- build §2.3: supersession, not reopening. A new approval may reference a
  -- rejected one; nothing else is a legal target, and it has to be in the
  -- same project (a stray id from a different project would otherwise
  -- silently link two unrelated records' revision histories together).
  if p_supersedes_id is not null then
    select * into v_superseded from public.approvals
     where id = p_supersedes_id and deleted_at is null;
    if not found or v_superseded.project_id <> p_project_id then
      raise exception 'NOT_FOUND: superseded approval % does not exist in this project', p_supersedes_id
        using errcode = 'P0002';
    end if;
    if v_superseded.status <> 'rejected' then
      raise exception 'ILLEGAL_TRANSITION: only a rejected approval can be superseded' using errcode = '23514';
    end if;
  end if;

  select next_ap_seq, code into v_seq, v_code
    from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'NOT_FOUND: project % does not exist', p_project_id using errcode = 'P0002';
  end if;
  update public.projects set next_ap_seq = next_ap_seq + 1 where id = p_project_id;
  v_ref := 'AP-' || v_code || '-' || lpad(v_seq::text, 3, '0');

  insert into public.approvals (
    id, org_id, project_id, package_id, phase_id, ref_no, type, item, note,
    needed_by, supersedes_id, requested_by, created_by
  ) values (
    p_id, public.auth_org(), p_project_id, p_package_id, p_phase_id, v_ref, p_type, p_item, p_note,
    p_needed_by, p_supersedes_id, auth.uid(), auth.uid()
  ) returning * into v_row;

  perform public.fn_audit('approval', v_row.id, 'insert', null, to_jsonb(v_row));
  return v_row;
end;
$$;

revoke execute on function public.rpc_create_approval(uuid, uuid, uuid, public.approval_type, text, uuid, text, date, uuid) from public, anon;
grant execute on function public.rpc_create_approval(uuid, uuid, uuid, public.approval_type, text, uuid, text, date, uuid) to authenticated;

-- ── Decide ───────────────────────────────────────────────────────────────────
-- "Only a Client may decide an approval." Not admin, not owner — no bypass,
-- not even one behind a flag or a test helper (build §5's own guardrail: an
-- Admin performing the client's sign-off destroys the audit value of the
-- whole chain, 01-hld.md §7.1).
create or replace function public.rpc_decide_approval(
  p_approval_id uuid,
  p_decision    public.approval_status,
  p_reason      text default null
) returns public.approvals
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role   public.app_role;
  r        public.approvals;
  v_before jsonb;
begin
  -- Lock first, exactly the order build §2.1 numbers it in — a role check
  -- ahead of the lock would let two concurrent decisions on the very last
  -- pending copy of a pre-lock read race each other before either commits.
  select * into r from public.approvals
   where id = p_approval_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND: approval % does not exist', p_approval_id using errcode = 'P0002';
  end if;

  v_role := public.auth_role();
  if v_role <> 'client' then
    raise exception 'FORBIDDEN: only a client may decide an approval' using errcode = '42501';
  end if;
  if not public.is_member_of(r.project_id) then
    raise exception 'FORBIDDEN: not a member of project %', r.project_id using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'ILLEGAL_TRANSITION: approval % is already %', p_approval_id, r.status
      using errcode = '23514';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'ILLEGAL_TRANSITION: % is not a legal decision', p_decision using errcode = '23514';
  end if;
  if p_decision = 'rejected' and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED: a reason is required to reject' using errcode = '23514';
  end if;

  v_before := to_jsonb(r);

  update public.approvals set
    status          = p_decision,
    decided_by      = auth.uid(),
    decided_at      = now(),
    decision_reason = p_reason,
    updated_at = now(), updated_by = auth.uid()
  where id = p_approval_id
  returning * into r;

  perform public.fn_audit('approval', r.id, 'transition', v_before, to_jsonb(r));
  return r;
end;
$$;

revoke execute on function public.rpc_decide_approval(uuid, public.approval_status, text) from public, anon;
grant execute on function public.rpc_decide_approval(uuid, public.approval_status, text) to authenticated;
