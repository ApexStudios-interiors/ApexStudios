-- stock_requests: close three integrity / visibility gaps
--
-- Found inspecting the Stock Request workflow for the mobile app. All three
-- predate it. Not changed: the read policies, rpc_create_stock_request, the
-- state machine, the D55 rate rule, any application code.
--
-- ── A. No direct INSERT ──────────────────────────────────────────────────────
--
-- sr_insert (last redefined in 20261005090001) let any admin or site member
-- INSERT into stock_requests straight through PostgREST, so a site user's own
-- token could skip rpc_create_stock_request entirely and write any status
-- ('approved', 'delivered'), any rate (past D55 and a 'hidden' project), any
-- ref_no, approved_by/approved_at, inventory_item_id. Only membership, role
-- and org were checked.
--
-- Nothing in the application inserts directly: the web action and the mobile
-- route both go createStockRequestFor → rpc_create_stock_request; every other
-- reference to the table is a read. The only direct inserts are the seed and
-- test/e2e setup, on privileged connections that bypass RLS anyway.
--
-- The RPC does not need the policy either. It is SECURITY DEFINER, owned by
-- `postgres`, which holds BYPASSRLS — so its insert ignores policies even with
-- FORCE ROW LEVEL SECURITY. That is already proven in production:
-- stock_request_events and stock_movements have NO insert policy and the same
-- RPCs write them. So the policy is dropped, not narrowed: with no INSERT
-- policy, RLS refuses every direct insert by a normal session, and
-- rpc_create_stock_request (membership, role, material, quantity, D55,
-- ref_no under a row lock, audit) is the only way in — as the table's own
-- original comment already says of updates.
--
-- ── B. The transition RPC no longer hands `rate` to a non-admin ──────────────
--
-- rpc_transition_stock_request returns the whole stock_requests row. A site
-- supervisor marking a request delivered — which they may — received `rate`
-- and `billed_on_bill_id`: exactly the two columns v_stock_request_site omits
-- ("rate is the internal cost per unit; billed_on_bill_id would reveal which
-- materials have been billed"). The web action only reads id, project_id and
-- status, but the RPC is callable directly.
--
-- The smallest safe fix keeps the return TYPE (changing it would mean dropping
-- the function; its generated type is `unknown` and every caller reads only
-- id / project_id / status): for anyone but an admin, those two fields are
-- nulled in the returned row. Admins get the row exactly as before. The body
-- below is 20261005090001's verbatim, plus that one step at the end — after
-- the audit, which still records the full row.
--
-- ── C. inventory_item_id must be this request's own inventory ────────────────
--
-- inventory_item_id was accepted unchecked (its foreign key proves only that
-- the item exists). On delivery, rpc_transition_stock_request adds the
-- request's quantity to THAT item — so a request could credit stock to
-- another project's, or another organisation's, inventory.
--
-- The inventory model (20260909170006): every item has an org_id; project_id
-- is a project, or NULL for "the central store rather than a project". So a
-- request may name an item of its own organisation that is either in its own
-- project or the central store; anything else is refused, as the ancestry
-- triggers refuse a package or phase from elsewhere: NOT_FOUND, P0002. A null
-- inventory_item_id (a new material — the common case) is untouched.
-- Soft-deleted items are not refused here, matching the ancestry triggers;
-- out of scope.
--
-- It fires on insert, and on an update of inventory_item_id, project_id or
-- org_id — which includes the transition RPC linking a newly created item on
-- delivery (same org and project by construction, so it passes). SECURITY
-- DEFINER, search_path '', as the ancestry triggers: the lookup must see the
-- item whatever the caller's inventory RLS shows them; it returns no data.
--
-- Production (read-only, before writing this): 13 requests, 3 linked to an
-- item, none to another org or project, none to a missing item; no
-- central-store items yet; no delivery movement into another project's item.

-- A ─────────────────────────────────────────────────────────────────────────
drop policy if exists sr_insert on public.stock_requests;

-- B ─────────────────────────────────────────────────────────────────────────
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

  -- 20261007090006: what the CALLER receives. Anyone but an admin gets the
  -- row without the two columns v_stock_request_site omits — the internal
  -- rate and which bill the material was billed on. Everything above (the
  -- write, the stock effect, the event, the audit) used the real row.
  if not public.is_admin() then
    r.rate := null;
    r.billed_on_bill_id := null;
  end if;

  return r;
end;
$function$;

-- C ─────────────────────────────────────────────────────────────────────────
create or replace function public.trg_stock_requests_check_inventory_item()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item_org_id     uuid;
  v_item_project_id uuid;
begin
  if new.inventory_item_id is null then
    return new;
  end if;

  select ii.org_id, ii.project_id into v_item_org_id, v_item_project_id
    from public.inventory_items ii where ii.id = new.inventory_item_id;

  -- Not found, another organisation, or another project's own stock. A NULL
  -- item project is the central store, which any project of the org may draw
  -- on, so the project test applies only to a project item.
  if not found
     or v_item_org_id <> new.org_id
     or (v_item_project_id is not null and v_item_project_id <> new.project_id) then
    raise exception 'NOT_FOUND: inventory item % does not exist in this project', new.inventory_item_id
      using errcode = 'P0002';
  end if;

  return new;
end;
$$;

create trigger trg_stock_requests_inventory_item
  before insert or update of inventory_item_id, project_id, org_id
  on public.stock_requests
  for each row execute function public.trg_stock_requests_check_inventory_item();
