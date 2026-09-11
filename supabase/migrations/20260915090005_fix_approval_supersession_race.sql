-- 0038 — fix a double-supersession race in rpc_create_approval
--
-- Pre-merge review of build/08-approvals.md (PR #12) found this: the
-- superseded approval's status was read without a row lock, and nothing
-- checked whether it already HAD a successor. Two concurrent
-- rpc_create_approval calls against the same rejected approval (a double
-- click on "Raise revised approval", or two sessions racing) both read
-- status = 'rejected' before either commits, and both succeed — two live
-- approvals then both claim to supersede the same original, and
-- features/approvals/queries.ts's own supersededByRefNoBySupersedesId map
-- (keyed by supersedes_id) silently keeps only one of the two forward
-- links, dropping the other from the UI entirely.
--
-- Fixed with the same tool `rpc_transition_stock_request` and
-- `rpc_decide_approval` already use for exactly this class of race: lock the
-- row being depended on with `for update` BEFORE checking it, so a second
-- concurrent caller blocks until the first commits — and add the "already
-- superseded" check itself, evaluated only after that lock is held, so the
-- second caller's check runs against the first caller's now-committed
-- insert rather than a stale pre-commit snapshot.
--
-- Never edit an already-applied migration (AGENTS.md database rule 1) —
-- the whole function is recreated here, not altered in place in 0035.
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
  -- rejected one; nothing else is a legal target, it has to be in the same
  -- project, and it may not already have a successor (`for update` here is
  -- what makes the "already superseded" check below race-free).
  if p_supersedes_id is not null then
    select * into v_superseded from public.approvals
     where id = p_supersedes_id and deleted_at is null
     for update;
    if not found or v_superseded.project_id <> p_project_id then
      raise exception 'NOT_FOUND: superseded approval % does not exist in this project', p_supersedes_id
        using errcode = 'P0002';
    end if;
    if v_superseded.status <> 'rejected' then
      raise exception 'ILLEGAL_TRANSITION: only a rejected approval can be superseded' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.approvals where supersedes_id = p_supersedes_id and deleted_at is null
    ) then
      raise exception 'ILLEGAL_TRANSITION: approval % has already been superseded', p_supersedes_id
        using errcode = '23514';
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
