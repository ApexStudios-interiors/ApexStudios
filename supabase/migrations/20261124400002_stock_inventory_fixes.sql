-- Stock and inventory: the audited fixes (APX-03, 14, 15, 34, 42, 44, 69)
--
-- One file, because every part touches the same two tables and the same two
-- RPCs, and splitting them would mean re-creating rpc_transition_stock_request
-- three times. Each section names the audit item it closes.
--
-- Uses the 'cancelled' label added by 20261124400001 ONLY inside plpgsql
-- bodies (resolved when the function runs, not when it is created) and as
-- `status::text` in DDL, so this file applies even if a runner batches it
-- into one transaction with that one.
--
-- Production-safety notes, checked against the schema rather than assumed:
--   * every new column is nullable with no default: no table rewrite;
--   * the material-matching index (§E) is NOT unique. Every delivery before
--     this migration created its own inventory item (APX-15), so production
--     almost certainly already holds duplicate (project, name, unit) rows, and
--     a unique index would fail to build on them. Matching is made race-free
--     by an advisory lock instead (see §E); existing duplicates are left as
--     they are (stock_movements is append-only, so a merge would itself be a
--     pair of compensating movements per row — an admin can do exactly that
--     with Adjust, and that is the documented path).

-- ═════════════════════════════════════════════════════════════════════════════
-- A. APX-03 — a Site Supervisor must never read unit_cost
-- ═════════════════════════════════════════════════════════════════════════════
--
-- inventory_select and movements_select let the site role read the BASE
-- tables, which carry unit_cost — and a delivery copies the request's rate
-- into it, so D55's 'hidden' rate was one PostgREST call away
-- (GET /rest/v1/inventory_items?select=name,unit_cost).
--
-- inventory_items: a COLUMN-level fix, not a row-level one. A supervisor
-- legitimately reads item rows (names, quantities, minimum stock — and the
-- notifications view's inventory_low branch reads the base table under the
-- caller's own rights), so the rows stay visible to admin and site exactly as
-- inventory_select already scoped them; what goes is the privilege on the one
-- money column. `authenticated` (every signed-in role — Postgres has no
-- per-user column privilege) loses SELECT on the table and gets it back on
-- every column EXCEPT unit_cost. An admin reads cost through the admin-only
-- views and RPCs below, which run as their owner:
--   * v_inventory_status — becomes a definer view filtered to is_admin() and
--     the admin's own organisation (it was security_invoker, which would now
--     fail on unit_cost for everyone);
--   * rpc_inventory_stats — becomes security definer (it summed unit_cost
--     under the caller's rights), with inventory_select's predicates in its
--     body; total_value stays admin-only (D40);
--   * rpc_adjust_inventory and the other inventory RPCs were already definer.
-- No application code selects unit_cost from the base table (checked:
-- features/inventory/adjust.ts selects only id).
--
-- A NEW inventory_items column is NOT selectable by authenticated until a
-- migration grants it — column grants are explicit. That is deliberate (a
-- money column can never leak by default) and is the first thing to check if
-- a new column reads as "permission denied".
--
-- stock_movements: row-level, admin only. Nothing in the application reads the
-- ledger as a supervisor, so the site branch simply goes.
--
-- v_inventory_site (definer) also gains the org and role predicates it never
-- had (it relied on is_member_of alone, which is true for an admin of ANY org
-- and for a client member) and an `updated_at` column, so the notifications
-- view can read low stock from it if it moves off the base table.
-- getMaterialSuggestions (features/stock/actions.ts) reads it now too.

revoke select on public.inventory_items from authenticated, anon;
grant select (
  id, org_id, project_id, name, category, sku, unit, qty_on_hand, reorder_level,
  location, created_at, created_by, updated_at, updated_by, deleted_at
) on public.inventory_items to authenticated;

-- Unchanged from 20261005090001 — restated so this file shows the whole rule.
drop policy if exists inventory_select on public.inventory_items;
create policy inventory_select on public.inventory_items for select using (
  deleted_at is null
  and org_id = public.auth_org()
  and public.auth_role() = any (array['admin'::public.app_role, 'site'::public.app_role])
  and (project_id is null or public.is_member_of(project_id))
);

drop policy if exists movements_select on public.stock_movements;
create policy movements_select on public.stock_movements for select to authenticated using (
  org_id = public.auth_org()
  and public.is_admin()
);

-- The admin's inventory view, carrying unit_cost and stock_value: a definer
-- view now (see above), so it filters to an admin of the item's own org
-- itself. Same columns as 20260909170013 (i.* expands to the same list).
create or replace view public.v_inventory_status
with (security_invoker = off) as
select
  i.*,
  case when i.qty_on_hand = 0                then 'critical'
       when i.qty_on_hand < i.reorder_level  then 'low'
       else 'ok' end                          as stock_status,
  round(i.qty_on_hand * i.unit_cost, 2)       as stock_value
from public.inventory_items i
where i.deleted_at is null
  and i.org_id = public.auth_org()
  and public.is_admin();

comment on view public.v_inventory_status is
  'ADMIN ONLY. Carries unit_cost and stock_value. A definer view since 20261124400002 (authenticated has no SELECT on inventory_items.unit_cost), filtered in its own body to is_admin() and the caller''s org. stock_status is derived, never stored.';

-- Same columns, same order, plus updated_at appended (CREATE OR REPLACE VIEW
-- may only add columns at the end).
create or replace view public.v_inventory_site
with (security_invoker = off) as
select
  i.id,
  i.project_id,
  i.name,
  i.category,
  i.sku,
  i.unit,
  i.qty_on_hand,
  i.reorder_level,
  i.location,
  case when i.qty_on_hand = 0               then 'critical'
       when i.qty_on_hand < i.reorder_level then 'low'
       else 'ok' end as stock_status,
  i.updated_at
from public.inventory_items i
where i.deleted_at is null
  and i.org_id = public.auth_org()
  and public.auth_role() in ('admin', 'site')
  and (i.project_id is null or public.is_member_of(i.project_id));

comment on view public.v_inventory_site is
  'Site-facing. OMITS unit_cost and stock_value. Since 20261124400002 the ONLY way a supervisor reads inventory (inventory_items is admin-only). Scoped to the caller''s org, admin/site, and projects they belong to plus the central store.';

-- rpc_inventory_stats: body and output unchanged except the four scoping
-- predicates, which used to come from inventory_select under security invoker.
create or replace function public.rpc_inventory_stats(
  p_project_id uuid default null,
  p_search     text default null
)
returns table (
  total_items    bigint,
  total_value    numeric,
  low_count      bigint,
  critical_count bigint
)
language sql security definer
set search_path = ''
stable
as $$
  with pattern as (
    select '%' || replace(replace(replace(replace(p_search, '*', ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
  )
  select
    count(*),
    case when public.is_admin() then coalesce(sum(i.qty_on_hand * i.unit_cost), 0) else null end,
    count(*) filter (where i.qty_on_hand > 0 and i.qty_on_hand < i.reorder_level),
    count(*) filter (where i.qty_on_hand = 0)
  from public.inventory_items i
  cross join pattern
  where i.deleted_at is null
    -- 20261124400002: what inventory_select applied before it became
    -- admin-only. A client (or anyone outside admin/site) counts nothing.
    and i.org_id = public.auth_org()
    and public.auth_role() in ('admin', 'site')
    and (i.project_id is null or public.is_member_of(i.project_id))
    and (p_project_id is null or i.project_id = p_project_id)
    and (
      p_search is null
      or i.name ilike pattern.p escape '\'
      or i.category ilike pattern.p escape '\'
    );
$$;

revoke execute on function public.rpc_inventory_stats(uuid, text) from public, anon;
grant execute on function public.rpc_inventory_stats(uuid, text) to authenticated;

comment on function public.rpc_inventory_stats(uuid, text) is
  'Security definer since 20261124400002 (inventory_items is admin-only): scoped in the body to the caller''s org, admin/site, member projects and the central store. total_value is null for a non-admin caller (D40). p_search matches features/inventory/service.ts inventorySearchFilter exactly.';

-- ═════════════════════════════════════════════════════════════════════════════
-- B. APX-34 (inventory part) — no inventory row with stock but no ledger
-- ═════════════════════════════════════════════════════════════════════════════
--
-- An admin could INSERT an item with any qty_on_hand straight through
-- PostgREST, and no stock_movements row would ever explain it — the nightly
-- reconcile would flag drift on a row nobody adjusted. A direct insert must
-- start at zero; an opening balance is then rpc_adjust_inventory (reason
-- required, movement and audit written).
drop policy if exists inventory_insert on public.inventory_items;
create policy inventory_insert on public.inventory_items for insert to authenticated with check (
  org_id = public.auth_org()
  and public.is_admin()
  and qty_on_hand = 0
);

-- ═════════════════════════════════════════════════════════════════════════════
-- C. New stock_requests columns (APX-42 cancel, APX-69 partial delivery)
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.stock_requests
  add column if not exists cancelled_at     timestamptz,
  add column if not exists cancelled_by     uuid references public.profiles(id),
  add column if not exists cancelled_reason text,
  -- Partial delivery: the remainder is a NEW request in 'ordered', linked back
  -- to the one that was part-delivered. See §F.
  add column if not exists split_from_id    uuid references public.stock_requests(id);

-- A cancelled request always says when. status::text, not the enum literal:
-- see this file's header.
alter table public.stock_requests drop constraint if exists sr_cancel_ck;
alter table public.stock_requests add constraint sr_cancel_ck
  check (status::text <> 'cancelled' or cancelled_at is not null);

create index if not exists idx_sr_split_from on public.stock_requests (split_from_id)
  where split_from_id is not null;

-- v_stock_request_site: same columns, same order, the three new non-money
-- ones appended. Still no rate, still no billed_on_bill_id.
create or replace view public.v_stock_request_site
with (security_invoker = off) as
select
  sr.id,
  sr.project_id,
  sr.package_id,
  sr.phase_id,
  sr.ref_no,
  sr.inventory_item_id,
  sr.material_name,
  sr.qty,
  sr.unit,
  sr.needed_by,
  sr.note,
  sr.status,
  sr.requested_by,
  sr.approved_at,
  sr.ordered_at,
  sr.delivered_at,
  sr.rejected_reason,
  sr.created_at,
  sr.cancelled_at,
  sr.cancelled_reason,
  sr.split_from_id
from public.stock_requests sr
where sr.deleted_at is null and public.is_member_of(sr.project_id);

comment on view public.v_stock_request_site is
  'Site-facing. OMITS rate and billed_on_bill_id. rate is the internal cost per unit; billed_on_bill_id would reveal which materials have been billed and therefore that they carry a margin.';

-- ═════════════════════════════════════════════════════════════════════════════
-- D. APX-44 — a retried create is "already submitted", not a second request
-- ═════════════════════════════════════════════════════════════════════════════
--
-- rpc_create_stock_request takes a client-generated id (p_id), as
-- rpc_create_approval and the daily-update insert already do. A retry after a
-- lost response carries the same id and is refused ALREADY_SUBMITTED, which
-- the application shows as "already submitted" instead of raising SR-…-015
-- next to SR-…-014. The check runs AFTER the project row lock, so two
-- concurrent calls with one id are serialised and the second sees the first's
-- committed row (the primary key would refuse it anyway).
--
-- p_id is last and optional: the mobile app, which does not send one yet,
-- keeps working exactly as before. Adding a parameter changes the function's
-- identity, so the old one is dropped first — leaving both would make every
-- call that omits p_id ambiguous to PostgREST (PGRST203), the same reason
-- 20260917120001 dropped rpc_inventory_stats(uuid).
--
-- Unchanged from 20261005090001: membership, role, material, quantity, the
-- D55 rate rule, the ref number under the project lock, the audit.
drop function if exists public.rpc_create_stock_request(uuid, uuid, text, numeric, text, uuid, uuid, numeric, date, text);

create function public.rpc_create_stock_request(
  p_project_id        uuid,
  p_package_id        uuid,
  p_material_name     text,
  p_qty               numeric,
  p_unit              text,
  p_phase_id          uuid    default null,
  p_inventory_item_id uuid    default null,
  p_rate              numeric default null,
  p_needed_by         date    default null,
  p_note              text    default null,
  p_id                uuid    default null
) returns public.stock_requests
language plpgsql security definer
set search_path = ''
as $$
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

  -- APX-44: after the lock, before the ref number is spent.
  if p_id is not null and exists (select 1 from public.stock_requests where id = p_id) then
    raise exception 'ALREADY_SUBMITTED: stock request % was already submitted', p_id using errcode = '23505';
  end if;

  update public.projects set next_sr_seq = next_sr_seq + 1 where id = p_project_id;
  v_ref := 'SR-' || v_code || '-' || lpad(v_seq::text, 3, '0');

  insert into public.stock_requests (
    id, org_id, project_id, package_id, phase_id, ref_no, inventory_item_id,
    material_name, qty, unit, rate, needed_by, note, requested_by, created_by
  ) values (
    coalesce(p_id, gen_random_uuid()),
    public.auth_org(), p_project_id, p_package_id, p_phase_id, v_ref, p_inventory_item_id,
    p_material_name, p_qty, p_unit,
    -- D55, unchanged: admin always; site only where the project is 'editable'.
    case
      when v_role = 'admin' then p_rate
      when v_role = 'site' and v_visibility = 'editable' then p_rate
      else null
    end,
    p_needed_by, p_note, auth.uid(), auth.uid()
  ) returning * into v_row;

  perform public.fn_audit('stock_request', v_row.id, 'insert', null, to_jsonb(v_row));

  -- What the caller receives: a non-admin never gets rate or
  -- billed_on_bill_id back (same rule as rpc_transition_stock_request).
  if v_role <> 'admin' then
    v_row.rate := null;
    v_row.billed_on_bill_id := null;
  end if;
  return v_row;
end;
$$;

revoke execute on function public.rpc_create_stock_request(uuid, uuid, text, numeric, text, uuid, uuid, numeric, date, text, uuid) from public, anon;
grant execute on function public.rpc_create_stock_request(uuid, uuid, text, numeric, text, uuid, uuid, numeric, date, text, uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- E. APX-15 — a delivery reuses the project's existing item for the material
-- ═════════════════════════════════════════════════════════════════════════════
--
-- The one normal form both sides of a material comparison are put into:
-- trimmed, inner whitespace collapsed, lower-cased. Identical to
-- features/stock/service.ts normalizeMaterialName. Immutable so it can index.
create or replace function public.fn_normalize_material_name(p_name text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(p_name), '\s+', ' ', 'g')) $$;

-- inventory_sku_uq (20260909170006) is `unique nulls not distinct (org_id,
-- project_id, sku)`. Nothing in the application sets a SKU, and a delivery
-- creates a SKU-less item for each new material — so `nulls not distinct`
-- let a project hold exactly ONE item without a SKU, and the second
-- new-material delivery on any project failed with a unique violation. The
-- rule it was meant to enforce is "a SKU is unique within a project (or the
-- central store)": a partial unique index over rows that HAVE a SKU. It keeps
-- `nulls not distinct` for project_id, so two central-store items still cannot
-- share a SKU.
--
-- Production-safe: the old constraint is strictly stronger than the new index
-- (it covered every row the index covers, with the same key), so no existing
-- row can violate the index and its build cannot fail.
alter table public.inventory_items drop constraint if exists inventory_sku_uq;
create unique index if not exists inventory_sku_uq
  on public.inventory_items (org_id, project_id, sku) nulls not distinct
  where sku is not null;

-- Non-unique by design — see this file's header. Supports the lookup in §F.
create index if not exists idx_inventory_material_match
  on public.inventory_items (org_id, project_id, public.fn_normalize_material_name(name), unit)
  where deleted_at is null;

-- ═════════════════════════════════════════════════════════════════════════════
-- F. rpc_transition_stock_request — rate on approval (APX-14), cancel
--    (APX-42), partial delivery (APX-69), item matching (APX-15)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Two new, optional, trailing parameters:
--   p_rate          admin only, pending → approved. The rate the request will
--                   carry from now on. Approving a request that has NO rate
--                   and is given none is refused RATE_REQUIRED: a request
--                   raised by Site on a 'hidden' project (the default) used to
--                   be approved, ordered, delivered and billed at ₹0. A
--                   request that already has a rate (admin- or
--                   'editable'-entered) may be approved without one, keeping
--                   it. Passing p_rate on any other move, or as a non-admin,
--                   is refused rather than silently ignored.
--   p_delivered_qty ordered → delivered. Omitted (or equal to qty): the whole
--                   request, as before. Less than qty: PARTIAL delivery —
--                   this request is delivered for p_delivered_qty, and the
--                   remainder becomes a NEW request, status 'ordered', with
--                   its own ref number, the same package/phase/material/unit/
--                   rate/needed-by/requester/approval, and split_from_id
--                   pointing back here. More than qty, zero or negative is
--                   refused.
--
--   Why a new request for the remainder rather than a delivered_qty column:
--   every reader of stock_requests (committed budget, Billable Now, MAS
--   recovery, the bell, the mobile app) already reads `qty` with `status`.
--   Splitting keeps every one of them right with no change — committed is
--   still delivered + ordered = the original total, Billable Now bills only
--   what arrived — where a second quantity column would need every one of
--   them rewritten. The original requested quantity is kept in the audit row
--   and is recoverable as qty + the remainder's qty.
--
-- New transition: → 'cancelled' (terminal).
--   pending  → cancelled: the requester only (their own mistake to withdraw).
--                         An admin who did not raise it uses Reject.
--   approved → cancelled, ordered → cancelled: admin only, reason required.
--   The reason is kept in cancelled_reason (rejected_reason stays the
--   rejection's own); cancelled_at / cancelled_by record who and when.
--
-- Delivery of a request with no linked item now looks for this project's
-- existing live item with the same normalised name and unit (oldest first,
-- should historical duplicates exist) before creating one, so two
-- 'Cement OPC 53' deliveries land on one row. A transaction-scoped advisory
-- lock on (org, project, name, unit) serialises two concurrent deliveries of
-- the same new material, so they cannot both miss and both insert. An item
-- that was created with unit_cost 0 (a rate-less delivery before APX-14)
-- takes the first real rate delivered into it; a non-zero unit_cost is never
-- overwritten.
--
-- Everything else is 20261007090006's body: the row lock, membership, the
-- legality table, who may make each move, the rejection reason, the event,
-- the audit, and the non-admin return with rate/billed_on_bill_id nulled.
drop function if exists public.rpc_transition_stock_request(uuid, public.stock_request_status, text);

create function public.rpc_transition_stock_request(
  p_request_id    uuid,
  p_to_status     public.stock_request_status,
  p_note          text    default null,
  p_rate          numeric default null,
  p_delivered_qty numeric default null
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
  v_remainder     numeric;
  v_seq           int;
  v_code          text;
  v_child         public.stock_requests;
begin
  v_role := public.auth_role();

  -- The row lock: what makes two concurrent "Delivered" taps safe.
  select * into r from public.stock_requests
   where id = p_request_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND: stock request % does not exist', p_request_id using errcode = 'P0002';
  end if;
  if not public.is_member_of(r.project_id) then
    raise exception 'FORBIDDEN: not a member of project %', r.project_id using errcode = '42501';
  end if;

  v_before_status := r.status;
  v_before := to_jsonb(r);

  if not (
    (r.status = 'pending' and p_to_status in ('approved', 'rejected', 'cancelled'))
    or (r.status = 'approved' and p_to_status in ('ordered', 'cancelled'))
    or (r.status = 'ordered' and p_to_status in ('delivered', 'cancelled'))
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

  -- Cancel: the requester while pending; an admin, with a reason, after.
  if p_to_status = 'cancelled' then
    if r.status = 'pending' then
      if r.requested_by is distinct from auth.uid() then
        raise exception 'FORBIDDEN: only the person who raised a pending request may cancel it' using errcode = '42501';
      end if;
    else
      if not public.is_admin() then
        raise exception 'FORBIDDEN: requires admin' using errcode = '42501';
      end if;
      if btrim(coalesce(p_note, '')) = '' then
        raise exception 'REASON_REQUIRED: a reason is required to cancel an approved or ordered request' using errcode = '23514';
      end if;
    end if;
  end if;

  -- APX-14: the rate, on approval only, admin only.
  if p_rate is not null then
    if not public.is_admin() then
      raise exception 'FORBIDDEN: only an admin may set a rate' using errcode = '42501';
    end if;
    if p_to_status <> 'approved' then
      raise exception 'ILLEGAL_TRANSITION: a rate can only be given when approving' using errcode = '23514';
    end if;
    if p_rate < 0 then
      raise exception 'RATE_REQUIRED: the rate cannot be negative' using errcode = '23514';
    end if;
  end if;
  if p_to_status = 'approved' and p_rate is null and r.rate is null then
    raise exception 'RATE_REQUIRED: a rate is required to approve this request' using errcode = '23514';
  end if;

  -- APX-69: how much of it arrived.
  if p_delivered_qty is not null then
    if p_to_status <> 'delivered' then
      raise exception 'ILLEGAL_TRANSITION: a delivered quantity can only be given when marking delivered' using errcode = '23514';
    end if;
    if p_delivered_qty <= 0 or p_delivered_qty > r.qty then
      raise exception 'REASON_REQUIRED: the delivered quantity must be more than 0 and at most %', r.qty using errcode = '23514';
    end if;
  end if;
  v_remainder := case when p_to_status = 'delivered' and p_delivered_qty is not null
                      then r.qty - p_delivered_qty else 0 end;

  update public.stock_requests set
    status           = p_to_status,
    rate             = case when p_to_status = 'approved' and p_rate is not null then p_rate else rate end,
    qty              = case when v_remainder > 0 then p_delivered_qty else qty end,
    approved_by      = case when p_to_status = 'approved'  then auth.uid() else approved_by end,
    approved_at      = case when p_to_status = 'approved'  then now()      else approved_at end,
    ordered_at       = case when p_to_status = 'ordered'   then now()      else ordered_at end,
    delivered_by     = case when p_to_status = 'delivered' then auth.uid() else delivered_by end,
    delivered_at     = case when p_to_status = 'delivered' then now()      else delivered_at end,
    rejected_reason  = case when p_to_status = 'rejected'  then p_note     else rejected_reason end,
    cancelled_at     = case when p_to_status = 'cancelled' then now()      else cancelled_at end,
    cancelled_by     = case when p_to_status = 'cancelled' then auth.uid() else cancelled_by end,
    cancelled_reason = case when p_to_status = 'cancelled' then nullif(btrim(p_note), '') else cancelled_reason end,
    updated_at = now(), updated_by = auth.uid()
  where id = p_request_id
  returning * into r;

  if p_to_status = 'delivered' then
    v_item := r.inventory_item_id;
    if v_item is null then
      -- APX-15: one item per (org, project, material, unit). The advisory lock
      -- makes the look-up-then-insert atomic against another delivery of the
      -- same material; it is released at commit.
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        r.org_id::text || '|' || coalesce(r.project_id::text, '') || '|'
          || public.fn_normalize_material_name(r.material_name) || '|' || r.unit, 0));

      select i.id into v_item
        from public.inventory_items i
       where i.org_id = r.org_id
         and i.project_id is not distinct from r.project_id
         and public.fn_normalize_material_name(i.name) = public.fn_normalize_material_name(r.material_name)
         and i.unit = r.unit
         and i.deleted_at is null
       order by i.created_at, i.id
       limit 1;

      if v_item is null then
        insert into public.inventory_items (org_id, project_id, name, unit, qty_on_hand, reorder_level, unit_cost, created_by)
        values (r.org_id, r.project_id, btrim(r.material_name), r.unit, 0, 0, coalesce(r.rate, 0), auth.uid())
        returning id into v_item;
      end if;
      update public.stock_requests set inventory_item_id = v_item where id = r.id;
      r.inventory_item_id := v_item;
    end if;

    insert into public.stock_movements (org_id, inventory_item_id, project_id, direction, qty, unit_cost, ref_type, ref_id, created_by)
    values (r.org_id, v_item, r.project_id, 'in', r.qty, coalesce(r.rate, 0), 'stock_request', r.id, auth.uid());

    update public.inventory_items
       set qty_on_hand = qty_on_hand + r.qty,
           unit_cost   = case when unit_cost = 0 and r.rate is not null then r.rate else unit_cost end,
           updated_at  = now()
     where id = v_item;

    -- APX-69: the part that has not arrived stays Ordered, as its own request.
    if v_remainder > 0 then
      select next_sr_seq, code into v_seq, v_code
        from public.projects where id = r.project_id for update;
      update public.projects set next_sr_seq = next_sr_seq + 1 where id = r.project_id;

      insert into public.stock_requests (
        org_id, project_id, package_id, phase_id, ref_no, inventory_item_id,
        material_name, qty, unit, rate, needed_by, note, status,
        requested_by, approved_by, approved_at, ordered_at, split_from_id, created_by
      ) values (
        r.org_id, r.project_id, r.package_id, r.phase_id,
        'SR-' || v_code || '-' || lpad(v_seq::text, 3, '0'), r.inventory_item_id,
        r.material_name, v_remainder, r.unit, r.rate, r.needed_by, r.note, 'ordered',
        r.requested_by, r.approved_by, r.approved_at, r.ordered_at, r.id, auth.uid()
      ) returning * into v_child;

      insert into public.stock_request_events (request_id, from_status, to_status, actor_id, note)
      values (v_child.id, null, 'ordered', auth.uid(), 'Remainder of ' || r.ref_no || ' after a part delivery');
      perform public.fn_audit('stock_request', v_child.id, 'split', null, to_jsonb(v_child));
    end if;
  end if;

  insert into public.stock_request_events (request_id, from_status, to_status, actor_id, note)
  values (
    r.id, v_before_status, p_to_status, auth.uid(),
    case when v_remainder > 0
         then coalesce(nullif(btrim(p_note), '') || ' — ', '') || 'part delivery: ' || r.qty || ' of ' || (r.qty + v_remainder)
         else p_note end
  );

  perform public.fn_audit('stock_request', r.id, 'transition', v_before, to_jsonb(r));

  if not public.is_admin() then
    r.rate := null;
    r.billed_on_bill_id := null;
  end if;

  return r;
end;
$$;

revoke execute on function public.rpc_transition_stock_request(uuid, public.stock_request_status, text, numeric, numeric) from public, anon;
grant execute on function public.rpc_transition_stock_request(uuid, public.stock_request_status, text, numeric, numeric) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- G. APX-42 — edit a pending request (qty, needed-by, note)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- The person who raised it, or an admin, while it is still pending. Once an
-- admin has acted on it the request is a commitment and is corrected by
-- cancelling (admin, with a reason) and raising a new one. Material, unit,
-- package and phase are not editable here: a different material is a
-- different request. All three fields are replaced as given (a null needed-by
-- or note clears it), so the caller always sends the full intended state.
create or replace function public.rpc_edit_stock_request(
  p_request_id uuid,
  p_qty        numeric,
  p_needed_by  date default null,
  p_note       text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r        public.stock_requests;
  v_before jsonb;
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if public.auth_role() not in ('admin', 'site') then
    raise exception 'FORBIDDEN: requires admin or site' using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'REASON_REQUIRED: quantity must be positive' using errcode = '23514';
  end if;

  select * into r from public.stock_requests
   where id = p_request_id and deleted_at is null and org_id = public.auth_org() for update;
  if not found then
    raise exception 'NOT_FOUND: stock request % does not exist', p_request_id using errcode = 'P0002';
  end if;
  if not public.is_member_of(r.project_id) then
    raise exception 'FORBIDDEN: not a member of project %', r.project_id using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'ILLEGAL_TRANSITION: only a pending request can be edited' using errcode = '23514';
  end if;
  if r.requested_by is distinct from auth.uid() and not public.is_admin() then
    raise exception 'FORBIDDEN: only the person who raised this request, or an admin, may edit it' using errcode = '42501';
  end if;
  -- The form's own rule (features/stock/schema.ts), on IST's today — but only
  -- for a date being CHANGED: an unchanged, now-past date may be kept.
  if p_needed_by is not null and p_needed_by is distinct from r.needed_by and p_needed_by < v_today then
    raise exception 'REASON_REQUIRED: needed-by date cannot be in the past' using errcode = '23514';
  end if;

  v_before := jsonb_build_object('qty', r.qty, 'needed_by', r.needed_by, 'note', r.note);

  update public.stock_requests set
    qty = p_qty,
    needed_by = p_needed_by,
    note = nullif(btrim(p_note), ''),
    updated_at = now(), updated_by = auth.uid()
  where id = r.id
  returning * into r;

  perform public.fn_audit('stock_request', r.id, 'edit', v_before,
    jsonb_build_object('qty', r.qty, 'needed_by', r.needed_by, 'note', r.note));

  return jsonb_build_object('id', r.id, 'project_id', r.project_id, 'status', r.status);
end;
$$;

revoke execute on function public.rpc_edit_stock_request(uuid, numeric, date, text) from public, anon;
grant execute on function public.rpc_edit_stock_request(uuid, numeric, date, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- H. APX-14 — an admin sets or corrects the rate until delivery
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Pending, approved or ordered. From delivery the rate has been written into
-- the stock movement and may be on a bill, so it is frozen. Audited with the
-- before and after rate (audit_log is admin-only).
create or replace function public.rpc_set_stock_request_rate(
  p_request_id uuid,
  p_rate       numeric
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r        public.stock_requests;
  v_before numeric;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: only an admin may set a rate' using errcode = '42501';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'RATE_REQUIRED: the rate must be 0 or more' using errcode = '23514';
  end if;

  select * into r from public.stock_requests
   where id = p_request_id and deleted_at is null and org_id = public.auth_org() for update;
  if not found then
    raise exception 'NOT_FOUND: stock request % does not exist', p_request_id using errcode = 'P0002';
  end if;
  if r.status::text not in ('pending', 'approved', 'ordered') then
    raise exception 'ILLEGAL_TRANSITION: the rate is fixed once a request is %', r.status using errcode = '23514';
  end if;

  v_before := r.rate;
  if v_before is not distinct from p_rate then
    return jsonb_build_object('id', r.id, 'project_id', r.project_id, 'rate', r.rate);
  end if;

  update public.stock_requests set rate = p_rate, updated_at = now(), updated_by = auth.uid()
   where id = r.id
   returning * into r;

  perform public.fn_audit('stock_request', r.id, 'set_rate',
    jsonb_build_object('rate', v_before), jsonb_build_object('rate', r.rate));

  return jsonb_build_object('id', r.id, 'project_id', r.project_id, 'rate', r.rate);
end;
$$;

revoke execute on function public.rpc_set_stock_request_rate(uuid, numeric) from public, anon;
grant execute on function public.rpc_set_stock_request_rate(uuid, numeric) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- I. APX-15 — Minimum stock, audited
-- ═════════════════════════════════════════════════════════════════════════════
--
-- inventory_items has no update policy (qty moves only under RPC locks), so
-- reorder_level had no write path at all and low-stock could never fire.
-- Admin only; the same organisation scoping as rpc_adjust_inventory
-- (20261008090001). Returns no money.
create or replace function public.rpc_set_inventory_reorder_level(
  p_item_id       uuid,
  p_reorder_level numeric
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item   public.inventory_items;
  v_before numeric;
  v_org    uuid := public.auth_org();
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: only an admin may set minimum stock' using errcode = '42501';
  end if;
  if p_reorder_level is null or p_reorder_level < 0 then
    raise exception 'REASON_REQUIRED: minimum stock cannot be negative' using errcode = '23514';
  end if;

  select * into v_item from public.inventory_items
   where id = p_item_id and deleted_at is null and org_id = v_org for update;
  if not found or (v_item.project_id is not null and not exists (
    select 1 from public.projects p where p.id = v_item.project_id and p.org_id = v_org
  )) then
    raise exception 'NOT_FOUND: inventory item % does not exist', p_item_id using errcode = 'P0002';
  end if;

  v_before := v_item.reorder_level;
  if v_before <> p_reorder_level then
    update public.inventory_items
       set reorder_level = p_reorder_level, updated_at = now(), updated_by = auth.uid()
     where id = v_item.id
     returning * into v_item;
    perform public.fn_audit('inventory_item', v_item.id, 'set_reorder_level',
      jsonb_build_object('reorder_level', v_before), jsonb_build_object('reorder_level', v_item.reorder_level));
  end if;

  return jsonb_build_object(
    'id', v_item.id, 'project_id', v_item.project_id,
    'qty_on_hand', v_item.qty_on_hand, 'reorder_level', v_item.reorder_level);
end;
$$;

revoke execute on function public.rpc_set_inventory_reorder_level(uuid, numeric) from public, anon;
grant execute on function public.rpc_set_inventory_reorder_level(uuid, numeric) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- J. APX-69 — Record usage: material leaves stock on site
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Inventory only ever went up. A supervisor (or admin) records what was used
-- on a package: an 'out' movement (ref_type 'usage', ref_id the package),
-- never more than is on hand, under the item's row lock, audited. The package
-- must be live and in the item's project (for a central-store item, in any
-- project of the caller's organisation that they belong to). The movement's
-- unit_cost is the item's own, as rpc_adjust_inventory writes it; nothing
-- returned to the caller carries money.
create or replace function public.rpc_record_stock_usage(
  p_item_id    uuid,
  p_package_id uuid,
  p_qty        numeric,
  p_note       text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item        public.inventory_items;
  v_org         uuid := public.auth_org();
  v_pkg_project uuid;
begin
  if public.auth_role() not in ('admin', 'site') then
    raise exception 'FORBIDDEN: requires admin or site' using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'REASON_REQUIRED: quantity used must be positive' using errcode = '23514';
  end if;

  select * into v_item from public.inventory_items
   where id = p_item_id and deleted_at is null and org_id = v_org for update;
  if not found or (v_item.project_id is not null and not public.is_member_of(v_item.project_id)) then
    raise exception 'NOT_FOUND: inventory item % does not exist', p_item_id using errcode = 'P0002';
  end if;

  select pk.project_id into v_pkg_project
    from public.packages pk
    join public.projects p on p.id = pk.project_id
   where pk.id = p_package_id and pk.deleted_at is null and p.org_id = v_org;
  if not found
     or (v_item.project_id is not null and v_pkg_project <> v_item.project_id)
     or not public.is_member_of(v_pkg_project) then
    raise exception 'NOT_FOUND: package % does not exist for this item', p_package_id using errcode = 'P0002';
  end if;

  if p_qty > v_item.qty_on_hand then
    raise exception 'NEGATIVE_STOCK: only % on hand', v_item.qty_on_hand using errcode = '23514';
  end if;

  insert into public.stock_movements (org_id, inventory_item_id, project_id, direction, qty, unit_cost, ref_type, ref_id, reason, created_by)
  values (v_item.org_id, v_item.id, v_pkg_project, 'out', p_qty, v_item.unit_cost, 'usage', p_package_id,
          nullif(btrim(p_note), ''), auth.uid());

  update public.inventory_items
     set qty_on_hand = qty_on_hand - p_qty, updated_at = now(), updated_by = auth.uid()
   where id = v_item.id
   returning * into v_item;

  perform public.fn_audit('inventory_item', v_item.id, 'usage',
    jsonb_build_object('qty_on_hand', v_item.qty_on_hand + p_qty),
    jsonb_build_object('qty_on_hand', v_item.qty_on_hand, 'package_id', p_package_id, 'qty_used', p_qty));

  return jsonb_build_object(
    'id', v_item.id, 'project_id', v_item.project_id,
    'qty_on_hand', v_item.qty_on_hand, 'reorder_level', v_item.reorder_level);
end;
$$;

revoke execute on function public.rpc_record_stock_usage(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.rpc_record_stock_usage(uuid, uuid, numeric, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- K. APX-42 (approvals part) — the requester withdraws a pending approval
-- ═════════════════════════════════════════════════════════════════════════════
--
-- A soft delete (AGENTS.md rule 7), not a new status: a withdrawn request was
-- a mistake, not a decision, and every reader of approvals — the lists, the
-- client's bell (`deleted_at is null`), supersession ("a live approval
-- already points at this one") — already ignores a soft-deleted row. Only the
-- person who raised it, only while pending. rpc_decide_approval locks with
-- `deleted_at is null`, so a client deciding at the same moment either wins
-- (and this is then ILLEGAL_TRANSITION) or finds it gone (NOT_FOUND).
create or replace function public.rpc_withdraw_approval(p_approval_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.approvals;
begin
  select * into r from public.approvals
   where id = p_approval_id and deleted_at is null and org_id = public.auth_org() for update;
  if not found or not public.is_member_of(r.project_id) then
    raise exception 'NOT_FOUND: approval % does not exist', p_approval_id using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'ILLEGAL_TRANSITION: only a pending approval can be withdrawn' using errcode = '23514';
  end if;
  if r.requested_by is distinct from auth.uid() then
    raise exception 'FORBIDDEN: only the person who requested this approval may withdraw it' using errcode = '42501';
  end if;

  update public.approvals
     set deleted_at = now(), updated_at = now(), updated_by = auth.uid()
   where id = r.id;

  perform public.fn_audit('approval', r.id, 'withdraw', to_jsonb(r), jsonb_build_object('deleted', true));

  return jsonb_build_object('id', r.id, 'project_id', r.project_id);
end;
$$;

revoke execute on function public.rpc_withdraw_approval(uuid) from public, anon;
grant execute on function public.rpc_withdraw_approval(uuid) to authenticated;
