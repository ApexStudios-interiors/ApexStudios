-- rpc_adjust_inventory: the item must be the caller's own organisation's
--
-- The RPC is SECURITY DEFINER (it must write qty_on_hand and stock_movements,
-- which have no user write policy), so RLS does not apply inside it. Its only
-- authorisation was `is_admin()` — a ROLE test — and it then locked the item
-- by id alone. `is_admin()` says nothing about organisation, so an admin of
-- organisation A could adjust an item of organisation B by its id, writing a
-- stock movement and an audit row against B's stock. The web action and the
-- mobile route never offer such an item (both read it first under the
-- caller's RLS: inventory_select's `org_id = public.auth_org()`), but the RPC
-- is executable by every authenticated user directly.
--
-- The organisation relationship, as the schema has it (20260909170006):
--   * every inventory item has `org_id` (not null → orgs);
--   * `project_id` is a project of the item's, or NULL for "the central store
--     rather than a project" — a central-store item belongs to its org through
--     `org_id` alone;
--   * a project has `org_id` (not null → orgs).
-- The caller's organisation is `public.auth_org()` — the JWT's org_id claim,
-- else the caller's profile — exactly what inventory_select and every other
-- org-scoped policy compares against.
--
-- So, after the existing role and input checks and unchanged otherwise:
--   1. the item is looked up (and locked) only where org_id = auth_org();
--   2. a project item's project must also be in auth_org() — `is_member_of`
--      cannot be used for this, because for an admin it is true for ANY
--      project, of any organisation.
-- Anything else is NOT_FOUND, the same answer as an id that does not exist,
-- so another organisation's item is never confirmed to exist.
--
-- Unchanged: admin only (is_admin(), FORBIDDEN 42501); the reason required and
-- non-blank; the new quantity absolute and >= 0 (REASON_REQUIRED 23514); no-op
-- when unchanged; the stock movement (direction, abs(delta), unit_cost,
-- 'adjustment', reason, actor); the qty_on_hand update; the audit row; the
-- return type; the grants. The body is 20260913090002's verbatim, plus the two
-- checks below.

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
  v_org   uuid := public.auth_org();
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

  -- 20261008090001: only an item of the caller's own organisation is found.
  select * into v_item from public.inventory_items
   where id = p_item_id and deleted_at is null and org_id = v_org for update;
  if not found then
    raise exception 'NOT_FOUND: inventory item % does not exist', p_item_id using errcode = 'P0002';
  end if;

  -- 20261008090001: a project item's project must be the caller's
  -- organisation's too. A central-store item (project_id is null) belongs to
  -- the organisation through org_id, checked above.
  if v_item.project_id is not null and not exists (
    select 1 from public.projects p where p.id = v_item.project_id and p.org_id = v_org
  ) then
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
