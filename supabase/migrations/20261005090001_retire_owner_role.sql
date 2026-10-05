-- 0043 — three roles: admin, site, client. The owner role is retired.
--
-- Owner decision, 2026-10-05: "i only want three roles — admin supervisor
-- client". Every owner-only capability becomes an admin capability, and the
-- single owner account becomes an admin.
--
-- THE ENUM VALUE 'owner' IS NOT DROPPED, deliberately. audit_log.actor_role
-- is typed app_role and holds historical rows recording what an owner did;
-- audit_log is append-only (AGENTS.md database rule 6) and removing the value
-- would either rewrite or break that history. The value therefore survives as
-- a record of the past while nothing can produce it any more: no profile
-- carries it after this migration, no check accepts it, and the trigger below
-- still refuses to assign it.
--
-- What is LOST by this, stated plainly because it cannot be undone by
-- redeploying: the four admins are now equal. Any admin may change any other
-- admin's role, deactivate them, and reset their password. The rules that
-- prevented that existed only because one account outranked the others.
--
-- What is KEPT:
--   * nobody may change their own role or deactivate themselves;
--   * the org cannot be left with nobody in charge — the "last active owner"
--     invariant is translated to "last active admin", which protects the
--     organisation without making any admin outrank another.

-- ── 1. Functions that only needed owner removing from a role test ────────────
-- is_admin
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select public.auth_role() = 'admin' $function$;

-- rpc_create_approval
CREATE OR REPLACE FUNCTION public.rpc_create_approval(p_id uuid, p_project_id uuid, p_package_id uuid, p_type approval_type, p_item text, p_phase_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_needed_by date DEFAULT NULL::date, p_supersedes_id uuid DEFAULT NULL::uuid)
 RETURNS approvals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_role not in ('admin', 'site') then
    raise exception 'FORBIDDEN: requires admin or site' using errcode = '42501';
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
$function$;

-- rpc_create_project
CREATE OR REPLACE FUNCTION public.rpc_create_project(p_name text, p_client_id uuid, p_code text, p_location text, p_start_date date, p_package_names text[] DEFAULT '{}'::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project_id uuid;
  v_org_id     uuid;
  v_code       text;
  v_attempt    int := 0;
  v_constraint text;
  v_seq        int := 1;
  v_name       text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: only an admin may create a project';
  end if;

  v_org_id := public.auth_org();

  loop
    v_code := public.fn_next_project_code(v_org_id, p_code);
    begin
      insert into public.projects (org_id, client_id, code, name, location, start_date, created_by)
      values (v_org_id, p_client_id, v_code, p_name, p_location, p_start_date, auth.uid())
      returning id into v_project_id;
      exit;
    exception when unique_violation then
      -- A concurrent create committed this exact code between the lookup and
      -- the insert. Look again (the committed row is now visible) and retry.
      -- Anything other than the code constraint is not ours to swallow.
      get stacked diagnostics v_constraint = constraint_name;
      v_attempt := v_attempt + 1;
      if v_constraint is distinct from 'projects_code_uq' or v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  foreach v_name in array p_package_names loop
    insert into public.packages (org_id, project_id, seq_no, name, created_by)
    values (v_org_id, v_project_id, v_seq, v_name, auth.uid());
    v_seq := v_seq + 1;
  end loop;

  perform public.fn_audit(
    'project', v_project_id, 'insert', null,
    jsonb_build_object('name', p_name, 'code', v_code, 'package_count', array_length(p_package_names, 1))
  );

  return v_project_id;
end;
$function$;

-- rpc_create_stock_request
CREATE OR REPLACE FUNCTION public.rpc_create_stock_request(p_project_id uuid, p_package_id uuid, p_material_name text, p_qty numeric, p_unit text, p_phase_id uuid DEFAULT NULL::uuid, p_inventory_item_id uuid DEFAULT NULL::uuid, p_rate numeric DEFAULT NULL::numeric, p_needed_by date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS stock_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role       public.app_role;
  v_seq        int;
  v_code       text;
  v_ref        text;
  v_visibility text;
  v_row        public.stock_requests;
begin
  v_role := public.auth_role();

  if not public.is_member_of(p_project_id) then
    raise exception 'FORBIDDEN: not a member of project %', p_project_id using errcode = '42501';
  end if;
  if v_role not in ('admin', 'site') then
    raise exception 'FORBIDDEN: requires admin or site' using errcode = '42501';
  end if;
  if btrim(coalesce(p_material_name, '')) = '' then
    raise exception 'REASON_REQUIRED: material name is required' using errcode = '23514';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'REASON_REQUIRED: quantity must be positive' using errcode = '23514';
  end if;

  select next_sr_seq, code, rate_visibility into v_seq, v_code, v_visibility
    from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'NOT_FOUND: project % does not exist', p_project_id using errcode = 'P0002';
  end if;
  update public.projects set next_sr_seq = next_sr_seq + 1 where id = p_project_id;
  v_ref := 'SR-' || v_code || '-' || lpad(v_seq::text, 3, '0');

  insert into public.stock_requests (
    org_id, project_id, package_id, phase_id, ref_no, inventory_item_id,
    material_name, qty, unit, rate, needed_by, note, requested_by, created_by
  ) values (
    public.auth_org(), p_project_id, p_package_id, p_phase_id, v_ref, p_inventory_item_id,
    p_material_name, p_qty, p_unit,
    -- Admin: always, unchanged. Site: only where this project is
    -- explicitly set to 'editable' (D55) — 'hidden' and 'readonly' both
    -- discard whatever was sent. Any other role never reaches this line.
    case
      when v_role = 'admin' then p_rate
      when v_role = 'site' and v_visibility = 'editable' then p_rate
      else null
    end,
    p_needed_by, p_note, auth.uid(), auth.uid()
  ) returning * into v_row;

  perform public.fn_audit('stock_request', v_row.id, 'insert', null, to_jsonb(v_row));
  return v_row;
end;
$function$;

-- rpc_log_impersonation
CREATE OR REPLACE FUNCTION public.rpc_log_impersonation(p_action text, p_previewed_role text, p_project_ref text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: only an admin may impersonate';
  end if;
  if p_action not in ('start', 'stop') then
    raise exception 'VALIDATION: p_action must be start or stop';
  end if;

  perform public.fn_audit(
    'session',
    auth.uid(),
    'impersonate_' || p_action,
    null,
    jsonb_build_object('previewed_role', p_previewed_role, 'project_ref', p_project_ref)
  );
end;
$function$;

-- rpc_next_project_code
CREATE OR REPLACE FUNCTION public.rpc_next_project_code(p_base text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: only an admin may create a project';
  end if;
  return public.fn_next_project_code(public.auth_org(), p_base);
end;
$function$;

-- rpc_set_task_progress
CREATE OR REPLACE FUNCTION public.rpc_set_task_progress(p_task_id uuid, p_pct smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if not public.is_member_of(v_task.project_id) or public.auth_role() not in ('admin', 'site') then
    raise exception 'FORBIDDEN: rpc_set_task_progress requires project membership and admin/site';
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
$function$;

-- rpc_transition_bill
CREATE OR REPLACE FUNCTION public.rpc_transition_bill(p_bill_id uuid, p_to_status bill_status, p_note text DEFAULT NULL::text)
 RETURNS bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_bill      public.bills;
  v_role      public.app_role;
  v_from      public.bill_status;
  v_paid      numeric(14,2);
  v_phase_ids uuid[];
begin
  select * into v_bill from public.bills where id = p_bill_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND: bill % does not exist', p_bill_id using errcode = 'P0002';
  end if;
  if not public.is_member_of(v_bill.project_id) then
    raise exception 'FORBIDDEN: not a member of project %', v_bill.project_id using errcode = '42501';
  end if;

  v_role := public.auth_role();
  v_from := v_bill.status;

  if v_from = 'submitted' and p_to_status = 'certified' and v_role <> 'client' then
    raise exception 'FORBIDDEN: only a client may certify a bill' using errcode = '42501';
  end if;
  if v_from = 'submitted' and p_to_status = 'draft' and v_role <> 'client' then
    raise exception 'FORBIDDEN: only a client may reject a bill' using errcode = '42501';
  end if;
  if v_from = 'draft' and p_to_status in ('submitted', 'cancelled') and not public.is_admin() then
    raise exception 'FORBIDDEN: requires admin' using errcode = '42501';
  end if;
  if v_from = 'certified' and p_to_status = 'paid' and not public.is_admin() then
    raise exception 'FORBIDDEN: requires admin' using errcode = '42501';
  end if;

  if v_from = 'submitted' and p_to_status = 'draft' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'REASON_REQUIRED: a reason is required to reject a bill' using errcode = '23514';
  end if;

  if v_from = 'certified' and p_to_status = 'paid' then
    select coalesce(sum(amount), 0) into v_paid from public.payments where bill_id = p_bill_id;
    if v_paid < v_bill.net_payable then
      raise exception 'ILLEGAL_TRANSITION: payments (%) do not yet cover net_payable (%)', v_paid, v_bill.net_payable
        using errcode = '23514';
    end if;
  end if;

  select array_agg(source_id) into v_phase_ids
    from public.bill_lines where bill_id = p_bill_id and source_type = 'phase';

  if v_from = 'draft' and p_to_status = 'submitted' then
    update public.bills set status = 'submitted', submitted_at = now(), submitted_by = auth.uid()
     where id = p_bill_id;

  elsif v_from = 'draft' and p_to_status = 'cancelled' then
    -- The one place this system hard-deletes rows, deliberately: freeing
    -- idx_bill_lines_source is what returns these items to Billable Now.
    -- Comment it as an exception so nobody "fixes" it into a soft delete.
    delete from public.bill_lines where bill_id = p_bill_id;
    update public.phases set billing_status = 'billable' where id = any(v_phase_ids);
    update public.stock_requests set billed_on_bill_id = null where billed_on_bill_id = p_bill_id;
    -- A cancelled draft's "recovered" advance was never actually netted
    -- against a real invoice — reverse it, or the mobilisation ledger
    -- permanently overstates what has actually been recovered.
    update public.projects
       set mobilisation_recovered = greatest(mobilisation_recovered - v_bill.advance_recovery, 0)
     where id = v_bill.project_id;
    update public.bills set status = 'cancelled' where id = p_bill_id;

  elsif v_from = 'submitted' and p_to_status = 'certified' then
    update public.bills
       set status = 'certified', certified_at = now(), certified_by = auth.uid(), certification_note = p_note
     where id = p_bill_id;

  elsif v_from = 'submitted' and p_to_status = 'draft' then
    update public.bills set status = 'draft', revision = revision + 1 where id = p_bill_id;

  elsif v_from = 'certified' and p_to_status = 'paid' then
    update public.bills set status = 'paid', paid_at = now() where id = p_bill_id;
    update public.phases set billing_status = 'paid' where id = any(v_phase_ids);

  else
    raise exception 'ILLEGAL_TRANSITION: % to % is not a legal transition', v_from, p_to_status
      using errcode = '23514';
  end if;

  insert into public.bill_events (bill_id, from_status, to_status, actor_id, note)
  values (p_bill_id, v_from, p_to_status, auth.uid(), p_note);

  select * into v_bill from public.bills where id = p_bill_id;
  perform public.fn_audit(
    'bill', p_bill_id, 'transition',
    jsonb_build_object('status', v_from), jsonb_build_object('status', p_to_status)
  );
  return v_bill;
end;
$function$;

-- rpc_transition_stock_request
CREATE OR REPLACE FUNCTION public.rpc_transition_stock_request(p_request_id uuid, p_to_status stock_request_status, p_note text DEFAULT NULL::text)
 RETURNS stock_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r               public.stock_requests;
  v_role          public.app_role;
  v_item          uuid;
  v_before_status public.stock_request_status;
  v_before        jsonb;
begin
  v_role := public.auth_role();

  -- The row lock: what makes two concurrent "Delivered" taps safe. The
  -- second waits, re-reads status = 'delivered', and fails the legality
  -- check below — no double stock.
  select * into r from public.stock_requests
   where id = p_request_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND: stock request % does not exist', p_request_id using errcode = 'P0002';
  end if;
  if not public.is_member_of(r.project_id) then
    raise exception 'FORBIDDEN: not a member of project %', r.project_id using errcode = '42501';
  end if;

  -- Captured BEFORE the update below overwrites r — see this file's own
  -- header comment for why 02-lld.md §5.4's literal pseudocode gets this
  -- wrong.
  v_before_status := r.status;
  v_before := to_jsonb(r);

  if not (
    (r.status = 'pending' and p_to_status in ('approved', 'rejected'))
    or (r.status = 'approved' and p_to_status = 'ordered')
    or (r.status = 'ordered' and p_to_status = 'delivered')
  ) then
    raise exception 'ILLEGAL_TRANSITION: % to % is not a legal transition', r.status, p_to_status
      using errcode = '23514';
  end if;

  if p_to_status in ('approved', 'rejected', 'ordered') and not public.is_admin() then
    raise exception 'FORBIDDEN: requires admin' using errcode = '42501';
  end if;
  if p_to_status = 'delivered' and v_role not in ('admin', 'site') then
    raise exception 'FORBIDDEN: requires admin or site' using errcode = '42501';
  end if;
  if p_to_status = 'rejected' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'REASON_REQUIRED: a reason is required to reject a request' using errcode = '23514';
  end if;

  update public.stock_requests set
    status          = p_to_status,
    approved_by     = case when p_to_status = 'approved'  then auth.uid() else approved_by end,
    approved_at     = case when p_to_status = 'approved'  then now()      else approved_at end,
    ordered_at      = case when p_to_status = 'ordered'   then now()      else ordered_at end,
    delivered_by    = case when p_to_status = 'delivered' then auth.uid() else delivered_by end,
    delivered_at    = case when p_to_status = 'delivered' then now()      else delivered_at end,
    rejected_reason = case when p_to_status = 'rejected'  then p_note     else rejected_reason end,
    updated_at = now(), updated_by = auth.uid()
  where id = p_request_id
  returning * into r;

  -- Stock effect on delivery, same transaction: create the item if this
  -- material was never in inventory, write the movement, move the cache.
  if p_to_status = 'delivered' then
    v_item := r.inventory_item_id;
    if v_item is null then
      insert into public.inventory_items (org_id, project_id, name, unit, qty_on_hand, reorder_level, unit_cost, created_by)
      values (r.org_id, r.project_id, r.material_name, r.unit, 0, 0, coalesce(r.rate, 0), auth.uid())
      returning id into v_item;
      update public.stock_requests set inventory_item_id = v_item where id = r.id;
      r.inventory_item_id := v_item;
    end if;

    insert into public.stock_movements (org_id, inventory_item_id, project_id, direction, qty, unit_cost, ref_type, ref_id, created_by)
    values (r.org_id, v_item, r.project_id, 'in', r.qty, coalesce(r.rate, 0), 'stock_request', r.id, auth.uid());

    update public.inventory_items
       set qty_on_hand = qty_on_hand + r.qty, updated_at = now()
     where id = v_item;
  end if;

  insert into public.stock_request_events (request_id, from_status, to_status, actor_id, note)
  values (r.id, v_before_status, p_to_status, auth.uid(), p_note);

  perform public.fn_audit('stock_request', r.id, 'transition', v_before, to_jsonb(r));
  return r;
end;
$function$;

-- ── 3. The privilege guard, rewritten ────────────────────────────────────────
-- Was: owner/admin may act, admins only on site and client, the owner role
-- cannot be assigned, and the last active owner cannot be demoted.
-- Now:  admins may act on anyone but themselves, the owner role still cannot
-- be assigned (it is history, not a role), and the last active ADMIN cannot be
-- demoted, deactivated or deleted.
create or replace function public.fn_guard_profile_privilege_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor        uuid := auth.uid();
  v_actor_role   public.app_role;
  v_changed      boolean := new.role is distinct from old.role
                            or new.is_active is distinct from old.is_active;
  v_drops_admin  boolean;
begin
  -- Would this update remove an active admin — by demotion, deactivation or
  -- soft delete? deleted_at is included because a soft delete is the third way
  -- to reach zero admins, and profiles.deleted_at is writable by the same
  -- policies as the other two columns.
  v_drops_admin := old.role = 'admin'
                   and old.is_active
                   and old.deleted_at is null
                   and (new.role <> 'admin' or not new.is_active or new.deleted_at is not null);

  -- No auth.uid() means no signed-in caller: the migration role, the seed, or
  -- service_role. Those already bypass RLS entirely, so there is no privilege
  -- here for them to gain — but the org invariant below still binds them.
  if v_changed and v_actor is not null then
    v_actor_role := public.auth_role();

    -- `is null` spelled out because `null <> 'admin'` is null, not true, and an
    -- `if` on null does nothing — a caller whose role could not be resolved
    -- would otherwise fall straight through every test below.
    if v_actor_role is null or v_actor_role <> 'admin' then
      raise exception 'FORBIDDEN: only an admin may change a role or deactivate a user';
    end if;

    if old.id = v_actor then
      raise exception 'FORBIDDEN: a user cannot change their own role or deactivate themselves';
    end if;

    if old.org_id is distinct from public.auth_org() then
      raise exception 'FORBIDDEN: that user is not in your organisation';
    end if;

    if old.deleted_at is not null then
      raise exception 'FORBIDDEN: that user has been deleted';
    end if;

    -- 'owner' is retired. The enum value survives for audit_log's history; it
    -- is not a role anyone can be given.
    if new.role = 'owner' and new.role is distinct from old.role then
      raise exception 'FORBIDDEN: the owner role has been retired and cannot be assigned';
    end if;
  end if;

  -- The org invariant, checked last so an unauthorised call fails with its own
  -- reason, and checked for every caller — including the backend role, and
  -- including an update that only sets deleted_at.
  if v_drops_admin then
    -- for update: hold every other active admin row for the rest of this
    -- transaction. A concurrent transaction demoting one of them blocks here
    -- and re-evaluates after the first commits, so the second finds no spare
    -- and raises. The lock and the test are one step.
    perform 1
       from public.profiles p
      where p.org_id = old.org_id
        and p.id <> old.id
        and p.role = 'admin'
        and p.is_active
        and p.deleted_at is null
        for update;

    if not found then
      raise exception 'FORBIDDEN: the last active admin cannot be demoted, deactivated or deleted';
    end if;
  end if;

  return new;
end;
$$;

-- ── 4. Password reset: admins are equal, so only self is refused ─────────────
-- D65 let an admin reset the owner but not a peer admin. With one rank there
-- is no peer to protect: an admin may reset anyone in the org except
-- themselves, who uses Change my password instead (D64).
create or replace function public.rpc_record_password_reset(p_target_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_caller_role   public.app_role := public.auth_role();
  v_target_role   public.app_role;
  v_target_active boolean;
begin
  if auth.uid() is null or v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'FORBIDDEN: only an admin may reset a password';
  end if;

  if p_target_id = auth.uid() then
    raise exception 'FORBIDDEN: a user cannot reset their own password here';
  end if;

  select p.role, p.is_active
    into v_target_role, v_target_active
    from public.profiles p
   where p.id = p_target_id
     and p.org_id = public.auth_org()
     and p.deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND: user';
  end if;

  if not v_target_active then
    raise exception 'FORBIDDEN: user is deactivated';
  end if;

  perform public.fn_audit(
    'profile',
    p_target_id,
    'password_reset',
    null,
    jsonb_build_object('target_role', v_target_role)
  );
end;
$$;

-- ── 5. RLS policies ──────────────────────────────────────────────────────────
-- Each one only loses 'owner' from its role list. orgs_update was owner-only
-- and becomes admin-only.
drop policy if exists ap_insert on public.approvals;
create policy ap_insert on public.approvals for insert with check (
  public.is_member_of(project_id)
  and public.auth_role() = any (array['admin'::public.app_role, 'site'::public.app_role])
  and org_id = public.auth_org()
);

drop policy if exists du_insert on public.daily_updates;
create policy du_insert on public.daily_updates for insert with check (
  public.is_member_of(project_id)
  and public.auth_role() = any (array['admin'::public.app_role, 'site'::public.app_role])
  and author_id = auth.uid()
  and org_id = public.auth_org()
);

drop policy if exists inventory_select on public.inventory_items;
create policy inventory_select on public.inventory_items for select using (
  deleted_at is null
  and org_id = public.auth_org()
  and public.auth_role() = any (array['admin'::public.app_role, 'site'::public.app_role])
  and (project_id is null or public.is_member_of(project_id))
);

drop policy if exists orgs_update on public.orgs;
create policy orgs_update on public.orgs for update
  using (id = public.auth_org() and public.auth_role() = 'admin')
  with check (id = public.auth_org());

drop policy if exists movements_select on public.stock_movements;
create policy movements_select on public.stock_movements for select using (
  org_id = public.auth_org()
  and public.auth_role() = any (array['admin'::public.app_role, 'site'::public.app_role])
  and (project_id is null or public.is_member_of(project_id))
);

drop policy if exists sr_insert on public.stock_requests;
create policy sr_insert on public.stock_requests for insert with check (
  public.is_member_of(project_id)
  and public.auth_role() = any (array['admin'::public.app_role, 'site'::public.app_role])
  and org_id = public.auth_org()
);

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert with check (
  public.is_member_of(project_id)
  and public.auth_role() = any (array['admin'::public.app_role, 'site'::public.app_role])
);

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (
    public.is_member_of(project_id)
    and public.auth_role() = any (array['admin'::public.app_role, 'site'::public.app_role])
  )
  with check (public.is_member_of(project_id));

-- ── 6. v_notifications: for_roles loses 'owner' ──────────────────────────────
create or replace view public.v_notifications
with (security_invoker = on) as
SELECT 'stock_request'::text AS kind,
    sr.id AS entity_id,
    sr.project_id,
    'Pending stock request: '::text || sr.material_name AS title,
    ('/projects/'::text || sr.project_id) || '/stock'::text AS href,
    sr.created_at,
    ARRAY['admin'::app_role, 'site'::app_role] AS for_roles
   FROM v_stock_request_site sr
  WHERE sr.status = 'pending'::stock_request_status
UNION ALL
 SELECT 'bill_submitted'::text AS kind,
    b.id AS entity_id,
    b.project_id,
    ('Bill '::text || b.bill_no) || ' awaiting certification'::text AS title,
    ('/projects/'::text || b.project_id) || '/billing'::text AS href,
    b.submitted_at AS created_at,
    ARRAY['admin'::app_role, 'client'::app_role] AS for_roles
   FROM v_bill_client b
  WHERE b.status = 'submitted'::bill_status
UNION ALL
 SELECT 'approval_pending'::text AS kind,
    a.id AS entity_id,
    a.project_id,
    'Approval needed: '::text || a.item AS title,
    ('/projects/'::text || a.project_id) || '/approvals'::text AS href,
    a.created_at,
    ARRAY['client'::app_role] AS for_roles
   FROM approvals a
  WHERE a.status = 'pending'::approval_status AND a.deleted_at IS NULL
UNION ALL
 SELECT 'inventory_low'::text AS kind,
    i.id AS entity_id,
    i.project_id,
    (i.name || ' is '::text) ||
        CASE
            WHEN i.qty_on_hand = 0::numeric THEN 'critical'::text
            ELSE 'low'::text
        END AS title,
    COALESCE(('/projects/'::text || i.project_id) || '/inventory'::text, '/inventory'::text) AS href,
    i.updated_at AS created_at,
    ARRAY['admin'::app_role, 'site'::app_role] AS for_roles
   FROM inventory_items i
  WHERE i.deleted_at IS NULL AND i.qty_on_hand < i.reorder_level;

comment on view public.v_notifications is
  'Computed live; no notification table. Read state lives in notification_reads (D60). Roles: admin, site, client — owner retired 2026-10-05.';

-- ── 7. The data, LAST ────────────────────────────────────────────────────────
-- Deliberately after the guard above and not before it. The OLD trigger
-- refuses to demote the last active owner — correctly, for the world it was
-- written for — so running this first aborts the migration on its own first
-- statement. Once the new guard is in place the demotion is ordinary: it
-- protects the last active ADMIN, and this row is not one yet.
update public.profiles set role = 'admin' where role = 'owner' and deleted_at is null;
