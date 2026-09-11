-- 0027 — rpc_create_stock_request, rpc_transition_stock_request, rpc_adjust_inventory
--
-- build/07-stock-inventory-notifications.md §2.1. 02-lld.md §5.4 is the source
-- for rpc_transition_stock_request's shape, with one real fix: its own
-- pseudocode captures `from_status` for stock_request_events (and the
-- "before" snapshot for fn_audit) AFTER `update ... returning * into r` has
-- already overwritten `r` with the POST-transition row — so `from_status`
-- would always equal `to_status`, and the audit log's own "before" would
-- always equal "after". Both are captured into separate variables BEFORE the
-- update below.

-- ── Create ───────────────────────────────────────────────────────────────────
-- D18: ref_no is SR-{project_code}-{n}, one counter per project
-- (projects.next_sr_seq, migration 0026) — the same row-lock pattern
-- rpc_create_bill takes for next_bill_seq, so the two numbering schemes never
-- race each other's project row either.
create or replace function public.rpc_create_stock_request(
  p_project_id        uuid,
  p_package_id        uuid,
  p_material_name     text,
  p_qty               numeric,
  p_unit              text,
  p_phase_id          uuid default null,
  p_inventory_item_id uuid default null,
  p_rate              numeric default null,
  p_needed_by         date default null,
  p_note              text default null
) returns public.stock_requests
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_seq  int;
  v_code text;
  v_ref  text;
  v_row  public.stock_requests;
begin
  v_role := public.auth_role();

  if not public.is_member_of(p_project_id) then
    raise exception 'FORBIDDEN: not a member of project %', p_project_id using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin', 'site') then
    raise exception 'FORBIDDEN: requires owner, admin or site' using errcode = '42501';
  end if;
  if btrim(coalesce(p_material_name, '')) = '' then
    raise exception 'REASON_REQUIRED: material name is required' using errcode = '23514';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'REASON_REQUIRED: quantity must be positive' using errcode = '23514';
  end if;

  select next_sr_seq, code into v_seq, v_code
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
    -- Defense in depth: the Server Action already strips `rate` before this
    -- RPC is ever called for a non-admin session (features/stock/actions.ts's
    -- own comment on why that has to happen before, not just in the UI) —
    -- this is the second, harder boundary, since a security definer function
    -- is the actual write path regardless of what called it.
    case when v_role in ('owner', 'admin') then p_rate else null end,
    p_needed_by, p_note, auth.uid(), auth.uid()
  ) returning * into v_row;

  perform public.fn_audit('stock_request', v_row.id, 'insert', null, to_jsonb(v_row));
  return v_row;
end;
$$;

revoke execute on function public.rpc_create_stock_request(uuid, uuid, text, numeric, text, uuid, uuid, numeric, date, text) from public, anon;
grant execute on function public.rpc_create_stock_request(uuid, uuid, text, numeric, text, uuid, uuid, numeric, date, text) to authenticated;

-- ── Transition ───────────────────────────────────────────────────────────────
create or replace function public.rpc_transition_stock_request(
  p_request_id uuid,
  p_to_status  public.stock_request_status,
  p_note       text default null
) returns public.stock_requests
language plpgsql security definer
set search_path = ''
as $$
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
  if p_to_status = 'delivered' and v_role not in ('owner', 'admin', 'site') then
    raise exception 'FORBIDDEN: requires owner, admin or site' using errcode = '42501';
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
$$;

revoke execute on function public.rpc_transition_stock_request(uuid, public.stock_request_status, text) from public, anon;
grant execute on function public.rpc_transition_stock_request(uuid, public.stock_request_status, text) to authenticated;

-- ── Adjust ───────────────────────────────────────────────────────────────────
-- D31 (docs/decisions.md): an adjustment is recorded as an 'in' or 'out'
-- movement (whichever sign the correction actually is), tagged
-- ref_type = 'adjustment' — not direction = 'adjust'. stock_movements.qty
-- must be positive (movements_qty_ck), so a signed correction needs its sign
-- carried by `direction` regardless; recording it as 'in'/'out' means
-- inventory.reconcile's recompute is one formula (Σ in − Σ out) with nothing
-- privileged about a correction, rather than a third bucket whose own sign
-- would have to be inferred from somewhere that doesn't exist in this table.
create or replace function public.rpc_adjust_inventory(
  p_item_id  uuid,
  p_new_qty  numeric,
  p_reason   text
) returns public.inventory_items
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item  public.inventory_items;
  v_delta numeric;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: rpc_adjust_inventory is admin-only' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED: a reason is required to adjust inventory' using errcode = '23514';
  end if;
  if p_new_qty is null or p_new_qty < 0 then
    raise exception 'REASON_REQUIRED: quantity cannot be negative' using errcode = '23514';
  end if;

  select * into v_item from public.inventory_items
   where id = p_item_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND: inventory item % does not exist', p_item_id using errcode = 'P0002';
  end if;

  v_delta := p_new_qty - v_item.qty_on_hand;
  if v_delta = 0 then
    return v_item; -- nothing changed — nothing to record
  end if;

  insert into public.stock_movements (org_id, inventory_item_id, project_id, direction, qty, unit_cost, ref_type, reason, created_by)
  values (
    v_item.org_id, v_item.id, v_item.project_id,
    -- Explicit casts are load-bearing, not stylistic — same reason
    -- rpc_finish_job's own CASE needs them (migration 0012's comment): an
    -- uncast CASE over text literals resolves to `text` before assignment,
    -- and Postgres has no implicit cast from text to a user-defined enum.
    -- Confirmed live: this raised "column direction is of type
    -- movement_direction but expression is of type text" without the casts.
    case when v_delta > 0 then 'in'::public.movement_direction else 'out'::public.movement_direction end,
    abs(v_delta), v_item.unit_cost, 'adjustment', p_reason, auth.uid()
  );

  update public.inventory_items
     set qty_on_hand = p_new_qty, updated_at = now(), updated_by = auth.uid()
   where id = p_item_id
   returning * into v_item;

  perform public.fn_audit('inventory_item', v_item.id, 'adjust',
    jsonb_build_object('qty_on_hand', v_item.qty_on_hand - v_delta),
    jsonb_build_object('qty_on_hand', v_item.qty_on_hand));

  return v_item;
end;
$$;

revoke execute on function public.rpc_adjust_inventory(uuid, numeric, text) from public, anon;
grant execute on function public.rpc_adjust_inventory(uuid, numeric, text) to authenticated;
